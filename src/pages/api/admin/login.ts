import { createHmac } from 'node:crypto';
import type { APIRoute } from 'astro';
import { createCmsClient } from '../../../lib/cms/server';
import {
  clearAdminSessionCookie,
  getSupabaseServerClient,
  isSameOrigin,
  isAdminAuthConfigured,
  setAdminSessionCookie,
} from '../../../lib/admin/auth';

export const prerender = false;

const json = (body: { error: string }, status: number, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

const ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS = 60;

function isRateLimitDecision(value: unknown): value is { allowed: boolean; retry_after_seconds: number } {
  if (!Array.isArray(value) || value.length !== 1) return false;
  const decision: unknown = value[0];
  return (
    typeof decision === 'object' &&
    decision !== null &&
    'allowed' in decision &&
    typeof decision.allowed === 'boolean' &&
    'retry_after_seconds' in decision &&
    typeof decision.retry_after_seconds === 'number' &&
    Number.isSafeInteger(decision.retry_after_seconds) &&
    (decision.allowed
      ? decision.retry_after_seconds === 0
      : decision.retry_after_seconds >= 1 &&
        decision.retry_after_seconds <= ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS)
  );
}

export const POST: APIRoute = async ({ request, cookies, clientAddress, url }) => {
  if (!isSameOrigin(request, url.origin)) return json({ error: 'Request origin could not be verified.' }, 403);
  if (!isAdminAuthConfigured()) return json({ error: 'Admin sign-in is not configured on this deployment.' }, 503);

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 4096) return json({ error: 'Invalid sign-in request.' }, 413);

  let credentials: { email?: unknown; password?: unknown };
  try {
    credentials = await request.json() as typeof credentials;
  } catch {
    return json({ error: 'Invalid sign-in request.' }, 400);
  }

  const email = typeof credentials.email === 'string' ? credentials.email.trim().toLowerCase() : '';
  const password = typeof credentials.password === 'string' ? credentials.password : '';
  if (!email || !password || email.length > 254 || password.length > 1024) {
    return json({ error: 'Enter a valid email address and password.' }, 400);
  }

  const rateLimitSecret = import.meta.env.ADMIN_SESSION_SECRET;
  if (!rateLimitSecret || Buffer.byteLength(rateLimitSecret) < 32) {
    return json({ error: 'Login protection is not configured on this deployment.' }, 503);
  }
  const limiter = createCmsClient();
  if (!limiter) return json({ error: 'Login protection is not configured on this deployment.' }, 503);

  const ipHash = createHmac('sha256', rateLimitSecret)
    .update(`ip:${clientAddress ?? 'unknown'}`)
    .digest('hex');
  const accountHash = createHmac('sha256', rateLimitSecret).update(`account:${email}`).digest('hex');
  let rateLimitResponse;
  try {
    rateLimitResponse = await limiter.rpc('check_admin_login_rate_limit', {
      p_ip_hash: ipHash,
      p_account_hash: accountHash,
    });
  } catch (error) {
    console.error('Admin login rate limiter unavailable:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Login protection is temporarily unavailable. Please try again later.' }, 503);
  }
  if (rateLimitResponse.error) {
    console.error('Admin login rate limiter unavailable:', rateLimitResponse.error.message);
    return json({ error: 'Login protection is temporarily unavailable. Please try again later.' }, 503);
  }
  if (!isRateLimitDecision(rateLimitResponse.data)) {
    console.error('Admin login rate limiter returned an invalid response.');
    return json({ error: 'Login protection is temporarily unavailable. Please try again later.' }, 503);
  }
  if (!rateLimitResponse.data.allowed) {
    return json(
      { error: 'Too many sign-in attempts. Please wait before trying again.' },
      429,
      { 'Retry-After': rateLimitResponse.data.retry_after_seconds.toString() },
    );
  }

  const client = getSupabaseServerClient(request, cookies);
  if (!client) return json({ error: 'Admin sign-in is not configured on this deployment.' }, 503);

  let signIn;
  try {
    signIn = await client.auth.signInWithPassword({ email, password });
  } catch (error) {
    console.error('Supabase admin sign-in request failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'The sign-in service is temporarily unavailable.' }, 503);
  }
  const { data, error } = signIn;
  if (error) {
    if (!error.status || error.status >= 500) {
      console.error('Supabase admin sign-in failed:', error.message);
      return json({ error: 'The sign-in service is temporarily unavailable.' }, 503);
    }
    return json({ error: 'The email or password was not accepted.' }, 401);
  }

  const ownerEmail = import.meta.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!ownerEmail || data.user?.email?.trim().toLowerCase() !== ownerEmail) {
    await client.auth.signOut({ scope: 'local' });
    clearAdminSessionCookie(cookies);
    return json({ error: 'The email or password was not accepted.' }, 401);
  }

  if (!setAdminSessionCookie(cookies)) {
    await client.auth.signOut({ scope: 'local' });
    return json({ error: 'Admin session security is not configured.' }, 503);
  }

  return new Response(JSON.stringify({ redirect: '/admin/' }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
