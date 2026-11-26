import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { createCmsClient, triggerCmsDeployment, writeCmsActivity } from '../../../lib/cms/server';

export const prerender = false;

function isAuthorized(request: Request) {
  const secret = import.meta.env.CRON_SECRET;
  const authorization = request.headers.get('authorization') ?? '';
  const expected = secret ? `Bearer ${secret}` : '';
  const actualBytes = Buffer.from(authorization);
  const expectedBytes = Buffer.from(expected);
  return Boolean(secret && secret.length >= 32 && actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes));
}

export const GET: APIRoute = async ({ request }) => {
  if (!isAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const client = createCmsClient();
  if (!client) return new Response('CMS database access is not configured.', { status: 503 });
  const deployHook = import.meta.env.VERCEL_DEPLOY_HOOK_URL;
  if (!deployHook) return new Response('Vercel deploy hook is not configured.', { status: 503 });

  const now = new Date().toISOString();
  const { data: dueItems, error } = await client
    .from('cms_content')
    .update({
      publication_state: 'published',
      scheduled_at: null,
      published_at: now,
      updated_at: now,
    })
    .eq('publication_state', 'scheduled')
    .lte('scheduled_at', now)
    .select('id,content_type,slug');
  if (error) {
    console.error('Scheduled content query failed:', error.message);
    return new Response('Could not publish scheduled content.', { status: 503 });
  }
  if (!dueItems.length) return Response.json({ published: 0 });

  for (const item of dueItems) {
    await writeCmsActivity(client, {
      actorId: null,
      action: 'scheduled_publish',
      contentType: item.content_type,
      contentSlug: item.slug,
    });
  }

  if (!await triggerCmsDeployment()) {
    return Response.json(
      { published: dueItems.length, deploymentTriggered: false },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return Response.json(
    { published: dueItems.length, deploymentTriggered: true },
    { headers: { 'Cache-Control': 'no-store' } },
  );
};
