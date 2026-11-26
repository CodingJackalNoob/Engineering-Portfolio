import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getAdminSession, isSameOrigin } from '../../../lib/admin/auth';
import { createCmsClient, triggerCmsDeployment, writeCmsActivity } from '../../../lib/cms/server';
import { contentMutationSchema, isValidSlug, parseContentData } from '../../../lib/cms/schemas';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });

type OwnerContext =
  | { ok: true; session: Extract<Awaited<ReturnType<typeof getAdminSession>>, { ok: true }>; client: NonNullable<ReturnType<typeof createCmsClient>> }
  | { ok: false; response: Response };

async function getOwner(
  request: Request,
  cookies: Parameters<typeof getAdminSession>[1],
): Promise<OwnerContext> {
  const session = await getAdminSession(request, cookies);
  if (!session.ok) return { ok: false, response: json({ error: 'Admin authorization is required.' }, session.status) };
  const client = createCmsClient();
  if (!client) return { ok: false, response: json({ error: 'CMS database access is not configured.' }, 503) };
  return { ok: true, session, client };
}

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const owner = await getOwner(request, cookies);
  if (!owner.ok) return owner.response;

  const type = url.searchParams.get('type');
  if (type && type !== 'project' && type !== 'article') {
    return json({ error: 'Unsupported content type.' }, 400);
  }

  let query = owner.client
    .from('cms_content')
    .select('id,content_type,slug,data,body,publication_state,scheduled_at,published_at,created_at,updated_at')
    .order('updated_at', { ascending: false });
  if (type) query = query.eq('content_type', type);
  const { data, error } = await query;
  if (error) {
    console.error('CMS content query failed:', error.message);
    return json({ error: 'Could not load content records.' }, 503);
  }

  return json({ items: data });
};

async function saveContent(
  request: Request,
  cookies: Parameters<typeof getAdminSession>[1],
  method: 'insert' | 'update',
): Promise<Response> {
  if (!isSameOrigin(request, new URL(request.url).origin)) {
    return json({ error: 'Request origin could not be verified.' }, 403);
  }

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 600_000) return json({ error: 'Content exceeds the maximum allowed size.' }, 413);

  const owner = await getOwner(request, cookies);
  if (!owner.ok) return owner.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }
  const input = contentMutationSchema.safeParse(body);
  if (!input.success) return json({ error: 'Content fields are invalid.', fields: z.flattenError(input.error) }, 400);
  if (method === 'insert' && input.data.id) return json({ error: 'New content must not include a record ID.' }, 400);
  if (method === 'update' && !input.data.id) return json({ error: 'An existing record ID is required.' }, 400);
  if (input.data.state === 'scheduled' && !input.data.scheduledAt) {
    return json({ error: 'Choose a publication date for scheduled content.' }, 400);
  }
  if (input.data.state !== 'scheduled' && input.data.scheduledAt) {
    return json({ error: 'A scheduled date is only valid for scheduled content.' }, 400);
  }

  let data;
  try {
    data = parseContentData(input.data.type, input.data.data);
  } catch (error) {
    if (error instanceof Error && 'issues' in error) {
      return json({ error: 'Content metadata is invalid.', fields: error.issues }, 400);
    }
    throw error;
  }
  const slug = typeof data.slug === 'string' ? data.slug : '';
  if (!isValidSlug(slug)) return json({ error: 'Use a lowercase, hyphen-separated URL slug.' }, 400);

  const deployHook = import.meta.env.VERCEL_DEPLOY_HOOK_URL;
  if (input.data.state === 'published' && !deployHook) {
    return json({ error: 'Publishing is unavailable until a Vercel deploy hook is configured.' }, 503);
  }

  const record = {
    content_type: input.data.type,
    slug,
    data,
    body: input.data.body,
    publication_state: input.data.state,
    scheduled_at: input.data.state === 'scheduled' ? input.data.scheduledAt : null,
    published_at: input.data.state === 'published' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
    ...(method === 'insert' ? { created_by: owner.session.user.id } : {}),
  };
  const operation = method === 'insert'
    ? owner.client.from('cms_content').insert(record)
    : owner.client.from('cms_content').update(record).eq('id', input.data.id!);
  const { data: saved, error } = await operation
    .select('id,content_type,slug,publication_state,scheduled_at,updated_at')
    .single();
  if (error) {
    console.error('CMS content save failed:', error.message);
    if (error.code === '23505') return json({ error: 'A record with that slug already exists.' }, 409);
    if (error.code === 'PGRST116') return json({ error: 'The content record no longer exists.' }, 404);
    return json({ error: 'Could not save this content record.' }, 503);
  }

  await writeCmsActivity(owner.client, {
    actorId: owner.session.user.id,
    action: input.data.state === 'published' ? 'published' : method === 'insert' ? 'created' : 'saved',
    contentType: input.data.type,
    contentSlug: slug,
  });

  if (input.data.state === 'published') {
    if (!await triggerCmsDeployment()) {
      return json({
        item: saved,
        warning: 'Content was saved as published, but the site deployment could not be triggered. Publish again to retry.',
      }, 502);
    }
  }

  return json({ item: saved }, method === 'insert' ? 201 : 200);
}

export const POST: APIRoute = ({ request, cookies }) => saveContent(request, cookies, 'insert');
export const PUT: APIRoute = ({ request, cookies }) => saveContent(request, cookies, 'update');

export const DELETE: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request, new URL(request.url).origin)) {
    return json({ error: 'Request origin could not be verified.' }, 403);
  }

  const owner = await getOwner(request, cookies);
  if (!owner.ok) return owner.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'A record ID is required.' }, 400);

  const { data: item, error: findError } = await owner.client
    .from('cms_content')
    .select('id,content_type,slug,publication_state')
    .eq('id', id)
    .maybeSingle();
  if (findError) {
    console.error('CMS content lookup failed:', findError.message);
    return json({ error: 'Could not load the content record.' }, 503);
  }
  if (!item) return json({ error: 'The content record no longer exists.' }, 404);

  const deployHook = import.meta.env.VERCEL_DEPLOY_HOOK_URL;
  if (item.publication_state === 'published' && !deployHook) {
    return json({ error: 'Published content cannot be removed until a Vercel deploy hook is configured.' }, 503);
  }

  const { error: deleteError } = await owner.client.from('cms_content').delete().eq('id', id);
  if (deleteError) {
    console.error('CMS content delete failed:', deleteError.message);
    return json({ error: 'Could not delete the content record.' }, 503);
  }
  await writeCmsActivity(owner.client, {
    actorId: owner.session.user.id,
    action: 'deleted',
    contentType: item.content_type,
    contentSlug: item.slug,
  });

  if (item.publication_state === 'published') {
    if (!await triggerCmsDeployment()) {
      return json({ warning: 'The record was deleted, but the site deployment could not be triggered.' }, 502);
    }
  }

  return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
};
