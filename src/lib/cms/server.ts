import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createCmsClient(): SupabaseClient | null {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function writeCmsActivity(
  client: SupabaseClient,
  activity: {
    actorId: string | null;
    action: string;
    contentType?: string;
    contentSlug?: string;
    details?: Record<string, unknown>;
  },
) {
  const { error } = await client.from('cms_activity').insert({
    actor_id: activity.actorId,
    action: activity.action,
    content_type: activity.contentType ?? null,
    content_slug: activity.contentSlug ?? null,
    details: activity.details ?? {},
  });
  if (error) throw new Error(`Could not record CMS activity: ${error.message}`);
}

export async function triggerCmsDeployment() {
  const deployHook = import.meta.env.VERCEL_DEPLOY_HOOK_URL;
  if (!deployHook) return false;
  try {
    const response = await fetch(deployHook, { method: 'POST' });
    if (response.ok) return true;
    console.error('Vercel deploy hook request failed:', response.status);
  } catch (error) {
    console.error('Vercel deploy hook request failed:', error instanceof Error ? error.message : 'unknown error');
  }
  return false;
}
