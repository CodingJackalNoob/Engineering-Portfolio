import type { APIRoute } from 'astro';
import { getAdminSession, isSameOrigin } from '../../../lib/admin/auth';
import { createCmsClient, triggerCmsDeployment, writeCmsActivity } from '../../../lib/cms/server';
import { mediaAssignmentGroupSchema } from '../../../lib/cms/media';
import { resolveMediaUrls } from '../../../lib/cms/media-storage';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });

const isMissingAssignmentTable = (error: { code?: string; message?: string }) =>
  (error.code === 'PGRST205' || error.code === '42P01') && error.message?.includes('cms_media_assignments');

async function authorize(request: Request, cookies: Parameters<typeof getAdminSession>[1]) {
  const session = await getAdminSession(request, cookies);
  if (!session.ok) return { ok: false as const, response: json({ error: 'Admin authorization is required.' }, session.status) };
  const client = createCmsClient();
  if (!client) return { ok: false as const, response: json({ error: 'CMS database access is not configured.' }, 503) };
  return { ok: true as const, session, client };
}

async function loadAssignments(
  client: NonNullable<ReturnType<typeof createCmsClient>>,
  filters: { ownerType?: string; ownerId?: string; fieldKey?: string },
) {
  let query = client.from('cms_media_assignments')
    .select('id,owner_type,owner_id,field_key,media_id,position,alt,caption,focal_x,focal_y,display_settings,created_at,updated_at')
    .order('position');
  if (filters.ownerType) query = query.eq('owner_type', filters.ownerType);
  if (filters.ownerId) query = query.eq('owner_id', filters.ownerId);
  if (filters.fieldKey) query = query.eq('field_key', filters.fieldKey);
  const { data: assignments, error } = await query.limit(500);
  if (error) throw Object.assign(new Error(`Could not load media assignments: ${error.message}`), { code: error.code });
  const ids = [...new Set((assignments ?? []).map((assignment) => assignment.media_id))];
  if (!ids.length) return [];

  const { data: mediaItems, error: mediaError } = await client.from('cms_media')
    .select('id,bucket,storage_path,original_name,content_type,size_bytes,alt,caption,folder,width,height,variants,created_at')
    .in('id', ids);
  if (mediaError) throw new Error(`Could not load assigned media records: ${mediaError.message}`);
  const mediaById = new Map((mediaItems ?? []).map((item) => [item.id, item]));

  return Promise.all((assignments ?? []).map(async (assignment) => {
    const media = mediaById.get(assignment.media_id);
    if (!media) throw new Error(`Media assignment ${assignment.id} references a missing media record.`);
    const urls = await resolveMediaUrls(client, media);
    return { ...assignment, media: { ...media, ...urls } };
  }));
}

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const owner = await authorize(request, cookies);
  if (!owner.ok) return owner.response;
  try {
    const items = await loadAssignments(owner.client, {
      ownerType: url.searchParams.get('ownerType') ?? undefined,
      ownerId: url.searchParams.get('ownerId') ?? undefined,
      fieldKey: url.searchParams.get('fieldKey') ?? undefined,
    });
    return json({ items });
  } catch (error) {
    console.error('CMS media assignment query failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: error instanceof Error && isMissingAssignmentTable(error as Error & { code?: string; message?: string })
      ? 'Media assignments are not installed. Apply the latest SQL migration in supabase/migrations/.'
      : 'Could not load media assignments.' }, 503);
  }
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request, new URL(request.url).origin)) return json({ error: 'Request origin could not be verified.' }, 403);
  const owner = await authorize(request, cookies);
  if (!owner.ok) return owner.response;

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 128_000) return json({ error: 'Media assignments exceed the maximum allowed size.' }, 413);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }
  const input = mediaAssignmentGroupSchema.safeParse(body);
  if (!input.success) return json({ error: 'Media assignment fields are invalid.', details: input.error.issues }, 400);
  const group = input.data;
  let requiresDeployment = group.ownerType !== 'project' && group.ownerType !== 'article';

  if (group.ownerType === 'project' || group.ownerType === 'article') {
    const { data: content, error } = await owner.client.from('cms_content')
      .select('id,content_type,publication_state')
      .eq('id', group.ownerId)
      .maybeSingle();
    if (error) {
      console.error('CMS media assignment owner lookup failed:', error.message);
      return json({ error: 'Could not verify the content record.' }, 503);
    }
    if (!content || content.content_type !== group.ownerType) return json({ error: 'The content record no longer exists.' }, 404);
    requiresDeployment = content.publication_state === 'published';
    if (content.publication_state === 'published' && group.items.length) {
      const { data: media, error: mediaError } = await owner.client.from('cms_media')
        .select('id,bucket')
        .in('id', group.items.map((item) => item.mediaId));
      if (mediaError) {
        console.error('Published media assignment validation failed:', mediaError.message);
        return json({ error: 'Could not verify the selected media.' }, 503);
      }
      if ((media ?? []).length !== new Set(group.items.map((item) => item.mediaId)).size ||
          media?.some((item) => item.bucket !== 'portfolio-media')) {
        return json({ error: 'Published content can only use media that has been published.' }, 409);
      }
    }
  } else if (group.items.length) {
    const { data: media, error } = await owner.client.from('cms_media')
      .select('id,bucket')
      .in('id', group.items.map((item) => item.mediaId));
    if (error) {
      console.error('Public media assignment validation failed:', error.message);
      return json({ error: 'Could not verify the selected media.' }, 503);
    }
    if ((media ?? []).length !== new Set(group.items.map((item) => item.mediaId)).size ||
        media?.some((item) => item.bucket !== 'portfolio-media')) {
      return json({ error: 'Public page assignments can only use media that has been published.' }, 409);
    }
  }

  const { error: saveError } = await owner.client.rpc('replace_cms_media_assignments', {
    p_owner_type: group.ownerType,
    p_owner_id: group.ownerId,
    p_field_key: group.fieldKey,
    p_items: group.items,
  });
  if (saveError) {
    const diagnostic = {
      code: saveError.code || undefined,
      message: saveError.message,
      details: saveError.details || undefined,
      hint: saveError.hint || undefined,
    };
    console.error('CMS media assignment RPC failed:', diagnostic);
    return json({
      error: 'Could not save these media assignments.',
      diagnostic,
    }, 503);
  }
  await writeCmsActivity(owner.client, {
    actorId: owner.session.user.id,
    action: 'updated_media_assignments',
    contentType: group.ownerType,
    contentSlug: group.ownerId,
    details: { fieldKey: group.fieldKey, itemCount: group.items.length },
  });

  let deploymentWarning: string | undefined;
  if (requiresDeployment) {
    if (!await triggerCmsDeployment()) deploymentWarning = 'Assignments were saved, but the public site deployment could not be triggered.';
  }
  return json({ saved: true, warning: deploymentWarning });
};
