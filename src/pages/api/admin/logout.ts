import type { APIRoute } from 'astro';
import { clearAdminSessionCookie, getSupabaseServerClient, isSameOrigin } from '../../../lib/admin/auth';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies, url }) => {
  if (!isSameOrigin(request, url.origin)) {
    return new Response('Request origin could not be verified.', { status: 403 });
  }

  const client = getSupabaseServerClient(request, cookies);
  if (!client) {
    clearAdminSessionCookie(cookies);
    return new Response('Admin sign-out is not configured.', { status: 503 });
  }

  clearAdminSessionCookie(cookies);
  let error;
  try {
    ({ error } = await client.auth.signOut({ scope: 'local' }));
  } catch (signOutError) {
    console.error('Supabase admin sign-out failed:', signOutError instanceof Error ? signOutError.message : 'unknown error');
    return new Response('Unable to revoke the admin session. Please retry.', { status: 503 });
  }
  if (error) {
    console.error('Supabase admin sign-out failed:', error.message);
    return new Response('Unable to revoke the admin session. Please retry.', { status: 503 });
  }

  return new Response(null, {
    status: 303,
    headers: { Location: '/admin/login/', 'Cache-Control': 'no-store' },
  });
};
