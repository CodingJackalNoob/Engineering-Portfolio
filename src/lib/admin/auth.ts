import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import type { User } from '@supabase/supabase-js';

const SESSION_COOKIE = 'portfolio_admin_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function getRequestCookies(request: Request) {
  const header = request.headers.get('cookie') ?? '';
  return header.split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return [];
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (!name) return [];
    try {
      return [{ name, value: decodeURIComponent(rawValue) }];
    } catch {
      return [{ name, value: rawValue }];
    }
  });
}

export function getSupabaseServerClient(request: Request, cookies: AstroCookies) {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => getRequestCookies(request),
      setAll: (items) => {
        for (const { name, value, options } of items) {
          cookies.set(name, value, {
            ...options,
            httpOnly: true,
            secure: import.meta.env.PROD,
            sameSite: 'strict',
            path: '/',
          });
        }
      },
    },
  });
}

function getSessionSecret() {
  const secret = import.meta.env.ADMIN_SESSION_SECRET;
  return secret && Buffer.byteLength(secret) >= 32 ? secret : null;
}

function hasSupabaseServerConfiguration() {
  return Boolean(import.meta.env.PUBLIC_SUPABASE_URL && import.meta.env.PUBLIC_SUPABASE_ANON_KEY);
}

export function isAdminAuthConfigured() {
  return Boolean(
    hasSupabaseServerConfiguration() &&
    import.meta.env.ADMIN_EMAIL &&
    import.meta.env.PUBLIC_SITE_URL &&
    getSessionSecret(),
  );
}

function signTimestamp(timestamp: string, secret: string) {
  return createHmac('sha256', secret).update(timestamp).digest('hex');
}

function createSessionToken(secret: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return `${timestamp}.${signTimestamp(timestamp, secret)}`;
}

function hasValidSessionToken(token: string | undefined, secret: string) {
  if (!token) return false;
  const [timestamp, signature, extra] = token.split('.');
  if (!timestamp || !signature || extra || !/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) return false;

  const issuedAt = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now || now - issuedAt > SESSION_TTL_SECONDS) return false;

  const expected = Buffer.from(signTimestamp(timestamp, secret), 'hex');
  const actual = Buffer.from(signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function setAdminSessionCookie(cookies: AstroCookies) {
  const secret = getSessionSecret();
  if (!secret) return false;

  cookies.set(SESSION_COOKIE, createSessionToken(secret), {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return true;
}

export function clearAdminSessionCookie(cookies: AstroCookies) {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

export type AdminSessionResult =
  | { ok: true; user: User; client: NonNullable<ReturnType<typeof getSupabaseServerClient>> }
  | { ok: false; status: 401 | 403 | 503 };

export async function getAdminSession(request: Request, cookies: AstroCookies): Promise<AdminSessionResult> {
  const secret = getSessionSecret();
  const client = getSupabaseServerClient(request, cookies);
  const adminEmail = import.meta.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!secret || !client || !adminEmail) return { ok: false, status: 503 };

  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!hasValidSessionToken(token, secret)) return { ok: false, status: 401 };

  let result;
  try {
    result = await client.auth.getUser();
  } catch (error) {
    console.error('Supabase admin session verification failed:', error instanceof Error ? error.message : 'unknown error');
    return { ok: false, status: 503 };
  }
  const { data, error } = result;
  if (error) {
    if (!error.status || error.status >= 500) {
      console.error('Supabase admin session verification failed:', error.message);
      return { ok: false, status: 503 };
    }
    return { ok: false, status: 401 };
  }
  if (!data.user) return { ok: false, status: 401 };
  if (data.user.email?.trim().toLowerCase() !== adminEmail) return { ok: false, status: 403 };

  return { ok: true, user: data.user, client };
}

export function isSameOrigin(request: Request, requestOrigin: string) {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  const configuredSiteUrl = import.meta.env.PUBLIC_SITE_URL;
  if (import.meta.env.PROD && !configuredSiteUrl) return false;
  let expectedOrigin: string;
  try {
    expectedOrigin = import.meta.env.PROD ? new URL(configuredSiteUrl!).origin : requestOrigin;
  } catch {
    return false;
  }
  return origin === expectedOrigin;
}
