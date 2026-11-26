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

type RateLimitDecision = { allowed: boolean; retry_after_seconds: number };

function parseRateLimitDecision(value: unknown): RateLimitDecision | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const row: unknown = value[0];
  if (typeof row !== 'object' || row === null || !('allowed' in row) || !('retry_after_seconds' in row)) {
    return null;
  }

  const allowed = row.allowed;
  const retryAfterSeconds = row.retry_after_seconds;
  if (
    typeof allowed !== 'boolean' ||
    typeof retryAfterSeconds !== 'number' ||
    !Number.isSafeInteger(retryAfterSeconds)
  ) {
    return null;
  }
  if (
    (allowed && retryAfterSeconds !== 0) ||
    (!allowed &&
      (retryAfterSeconds < 1 || retryAfterSeconds > ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS))
  ) {
    return null;
  }

  return { allowed, retry_after_seconds: retryAfterSeconds };
}

function getSafeErrorMetadata(error: unknown) {
  const metadata: { name?: string; code?: string; status?: number } = {};
  if (error instanceof Error) metadata.name = error.name;
  if (typeof error === 'object' && error !== null) {
    if ('code' in error && typeof error.code === 'string') metadata.code = error.code;
    if ('status' in error && typeof error.status === 'number') metadata.status = error.status;
  }
  return metadata;
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
    console.error('Admin login rate limiter request failed.', getSafeErrorMetadata(error));
    return json({ error: 'Login protection is temporarily unavailable. Please try again later.' }, 503);
  }
  if (rateLimitResponse.error) {
    console.error('Admin login rate limiter returned an error.', {
      code: rateLimitResponse.error.code,
      status: rateLimitResponse.status,
    });
    return json({ error: 'Login protection is temporarily unavailable. Please try again later.' }, 503);
  }
  const rateLimitDecision = parseRateLimitDecision(rateLimitResponse.data);
  if (!rateLimitDecision) {
    console.error('Admin login rate limiter returned an invalid response.', {
      isArray: Array.isArray(rateLimitResponse.data),
      rowCount: Array.isArray(rateLimitResponse.data) ? rateLimitResponse.data.length : undefined,
    });
    return json({ error: 'Login protection is temporarily unavailable. Please try again later.' }, 503);
  }
  if (!rateLimitDecision.allowed) {
    return json(
      { error: 'Too many sign-in attempts. Please wait before trying again.' },
      429,
      { 'Retry-After': String(rateLimitDecision.retry_after_seconds) },
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
