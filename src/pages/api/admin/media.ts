import { randomUUID } from 'node:crypto';
import type { APIRoute } from 'astro';
import { getAdminSession, isSameOrigin } from '../../../lib/admin/auth';
import { createCmsClient, triggerCmsDeployment, writeCmsActivity } from '../../../lib/cms/server';
import { MAX_MEDIA_UPLOAD_BYTES, processImageUpload } from '../../../lib/cms/media-processing';
import { getMediaStoragePaths, resolveMediaUrls } from '../../../lib/cms/media-storage';

export const prerender = false;

const PRIVATE_BUCKET = 'cms-media-private';
const PUBLIC_BUCKET = 'portfolio-media';
const mediaColumns = 'id,bucket,storage_path,original_name,content_type,size_bytes,alt,caption,folder,width,height,variants,created_at,updated_at';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });

async function authorize(request: Request, cookies: Parameters<typeof getAdminSession>[1]) {
  const session = await getAdminSession(request, cookies);
  if (!session.ok) return { ok: false as const, response: json({ error: 'Admin authorization is required.' }, session.status) };
  const client = createCmsClient();
  if (!client) return { ok: false as const, response: json({ error: 'CMS database access is not configured.' }, 503) };
  return { ok: true as const, session, client };
}

function isValidText(value: FormDataEntryValue | null, maxLength: number) {
  return typeof value === 'string' && value.length <= maxLength ? value.trim() : null;
}

async function storeVariants(
  client: NonNullable<ReturnType<typeof createCmsClient>>,
  bucket: string,
  prefix: string,
  variants: Record<string, Buffer>,
) {
  const paths = Object.fromEntries(Object.keys(variants).map((width) => [width, `${prefix}/${width}.webp`]));
  const uploaded: string[] = [];
  for (const [width, bytes] of Object.entries(variants)) {
    const storagePath = paths[width];
    const { error } = await client.storage.from(bucket).upload(storagePath, bytes, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) {
      if (uploaded.length) {
        const { error: cleanupError } = await client.storage.from(bucket).remove(uploaded);
        if (cleanupError) console.error('Failed to clean up partial image upload:', cleanupError.message);
      }
      throw new Error(error.message);
    }
    uploaded.push(storagePath);
  }
  return { paths, uploaded };
}

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const owner = await authorize(request, cookies);
  if (!owner.ok) return owner.response;

  const { data, error } = await owner.client
    .from('cms_media')
    .select(mediaColumns)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    console.error('CMS media query failed:', error.message);
    return json({ error: 'Could not load media records.' }, 503);
  }

  const { data: assignments, error: assignmentsError } = await owner.client.from('cms_media_assignments')
    .select('media_id,owner_type,owner_id,field_key,position')
    .order('owner_type')
    .limit(2000);
  if (assignmentsError) {
    console.error('CMS media usage query failed:', assignmentsError.message);
    return json({ error: 'Could not load media usage information. Verify that the media assignment migration is applied.' }, 503);
  }

  const search = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const folder = url.searchParams.get('folder')?.trim();
  const type = url.searchParams.get('type')?.trim();
  const usageType = url.searchParams.get('usageType')?.trim();
  const usage = url.searchParams.get('usage')?.trim();
  let items;
  try {
    items = await Promise.all((data ?? [])
      .filter((item) => (!folder || folder === 'all' || item.folder === folder) &&
        (!type || type === 'all' || item.content_type === type) &&
        (!search || `${item.original_name} ${item.alt} ${item.caption} ${item.folder}`.toLowerCase().includes(search)))
      .map(async (item) => {
        const uses = (assignments ?? []).filter((assignment) => assignment.media_id === item.id);
        const matchingUses = uses.filter((assignment) => !usageType || usageType === 'all' || assignment.owner_type === usageType);
        if (usage === 'used' && !matchingUses.length) return null;
        if (usage === 'unused' && uses.length) return null;
        if (usageType && usageType !== 'all' && !matchingUses.length) return null;
        const urls = await resolveMediaUrls(owner.client, item);
        return { ...item, ...urls, uses };
      }));
  } catch (error) {
    console.error('CMS media preview generation failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Could not create one or more media previews.' }, 503);
  }

  return json({ items: items.filter((item) => item !== null), folders: [...new Set((data ?? []).map((item) => item.folder))].sort() });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request, new URL(request.url).origin)) return json({ error: 'Request origin could not be verified.' }, 403);
  const owner = await authorize(request, cookies);
  if (!owner.ok) return owner.response;

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_MEDIA_UPLOAD_BYTES + 64_000) return json({ error: 'Image exceeds the 12 MB upload limit.' }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Upload must use a valid multipart form.' }, 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'Choose an image file to upload.' }, 400);

  const alt = isValidText(form.get('alt'), 500);
  const caption = isValidText(form.get('caption'), 1000);
  const folder = isValidText(form.get('folder'), 80);
  if (alt === null || caption === null || folder === null) {
    return json({ error: 'Alt text, caption, or folder name exceeds its allowed length.' }, 400);
  }

  let processed;
  try {
    processed = await processImageUpload(file);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'The image could not be decoded or optimized.' }, 400);
  }

  const id = randomUUID();
  let stored;
  try {
    stored = await storeVariants(owner.client, PRIVATE_BUCKET, id, processed.variants);
  } catch (error) {
    console.error('Supabase private media upload failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Could not store the image variants. Verify the media storage migration.' }, 503);
  }
  const storagePath = Object.values(stored.paths).at(-1)!;

  const { data: item, error: insertError } = await owner.client.from('cms_media').insert({
    id,
    bucket: PRIVATE_BUCKET,
    storage_path: storagePath,
    original_name: file.name.slice(0, 240) || 'portfolio-image',
    content_type: 'image/webp',
    size_bytes: processed.variants[Object.keys(processed.variants).at(-1)!].byteLength,
    alt,
    caption,
    folder: folder || 'uncategorized',
    width: processed.width,
    height: processed.height,
    variants: stored.paths,
    created_by: owner.session.user.id,
  }).select(mediaColumns).single();
  if (insertError) {
    const { error: cleanupError } = await owner.client.storage.from(PRIVATE_BUCKET).remove(stored.uploaded);
    if (cleanupError) console.error('Failed to clean up image upload after metadata error:', cleanupError.message);
    console.error('CMS media metadata insert failed:', insertError.message);
    return json({ error: 'Could not save image metadata.' }, 503);
  }

  await writeCmsActivity(owner.client, {
    actorId: owner.session.user.id,
    action: 'uploaded_media',
    details: { mediaId: item.id, name: item.original_name },
  });
  try {
    const urls = await resolveMediaUrls(owner.client, item);
    return json({ item: { ...item, ...urls } }, 201);
  } catch (error) {
    console.error('Private media preview URL creation failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'The image was uploaded, but a preview URL could not be created.' }, 503);
  }
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request, new URL(request.url).origin)) return json({ error: 'Request origin could not be verified.' }, 403);
  const owner = await authorize(request, cookies);
  if (!owner.ok) return owner.response;
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_MEDIA_UPLOAD_BYTES + 64_000) return json({ error: 'Image exceeds the 12 MB upload limit.' }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Replacement upload must use a valid multipart form.' }, 400);
  }
  const id = form.get('id');
  const file = form.get('file');
  if (typeof id !== 'string' || !(file instanceof File)) return json({ error: 'A media ID and replacement image are required.' }, 400);

  const { data: current, error: lookupError } = await owner.client.from('cms_media')
    .select(mediaColumns)
    .eq('id', id)
    .maybeSingle();
  if (lookupError) {
    console.error('CMS media replacement lookup failed:', lookupError.message);
    return json({ error: 'Could not load the media record.' }, 503);
  }
  if (!current) return json({ error: 'The media record no longer exists.' }, 404);

  let processed;
  try {
    processed = await processImageUpload(file);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'The image could not be decoded or optimized.' }, 400);
  }

  const prefix = `${id}/${randomUUID()}`;
  let stored;
  try {
    stored = await storeVariants(owner.client, current.bucket, prefix, processed.variants);
  } catch (error) {
    console.error('Supabase media replacement upload failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Could not store the replacement image.' }, 503);
  }
  const previousPaths = getMediaStoragePaths(current).map(([, storagePath]) => storagePath);
  const storagePath = Object.values(stored.paths).at(-1)!;
  const largestVariant = Object.keys(processed.variants).at(-1)!;
  const { data: item, error: updateError } = await owner.client.from('cms_media')
    .update({
      storage_path: storagePath,
      variants: stored.paths,
      width: processed.width,
      height: processed.height,
      size_bytes: processed.variants[largestVariant].byteLength,
      original_name: file.name.slice(0, 240) || current.original_name,
      updated_at: new Date().toISOString(),
    })
    .eq('id', current.id)
    .select(mediaColumns)
    .single();
  if (updateError) {
    const { error: cleanupError } = await owner.client.storage.from(current.bucket).remove(stored.uploaded);
    if (cleanupError) console.error('Failed to clean up replacement image after metadata error:', cleanupError.message);
    console.error('CMS media replacement metadata update failed:', updateError.message);
    return json({ error: 'Could not update the media record.' }, 503);
  }

  if (current.bucket !== PUBLIC_BUCKET) {
    const { error: oldFileError } = await owner.client.storage.from(current.bucket).remove(previousPaths);
    if (oldFileError) console.error('Superseded private media variants could not be removed:', oldFileError.message);
  } else {
    // Keep the old public objects available to pages served from the previous deployment or CDN cache.
    console.info('Superseded public media variants retained to prevent stale page references from breaking.');
  }
  await writeCmsActivity(owner.client, { actorId: owner.session.user.id, action: 'replaced_media', details: { mediaId: item.id } });
  let warning: string | undefined;
  if (item.bucket === PUBLIC_BUCKET && !await triggerCmsDeployment()) {
    warning = 'The image was replaced, but the public site deployment could not be triggered.';
  }
  try {
    return json({ item: { ...item, ...await resolveMediaUrls(owner.client, item) }, warning });
  } catch (error) {
    console.error('Replacement media preview URL creation failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'The image was replaced, but a preview URL could not be created.' }, 503);
  }
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request, new URL(request.url).origin)) return json({ error: 'Request origin could not be verified.' }, 403);
  const owner = await authorize(request, cookies);
  if (!owner.ok) return owner.response;

  let input: { id?: unknown; action?: unknown; alt?: unknown; caption?: unknown; folder?: unknown; originalName?: unknown };
  try {
    input = await request.json() as typeof input;
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }
  if (typeof input.id !== 'string' || typeof input.action !== 'string') return json({ error: 'A media ID and action are required.' }, 400);

  const { data: current, error: lookupError } = await owner.client
    .from('cms_media')
    .select(mediaColumns)
    .eq('id', input.id)
    .maybeSingle();
  if (lookupError) {
    console.error('CMS media lookup failed:', lookupError.message);
    return json({ error: 'Could not load the media record.' }, 503);
  }
  if (!current) return json({ error: 'The media record no longer exists.' }, 404);

  if (input.action === 'update') {
    if (typeof input.alt !== 'string' || input.alt.length > 500 ||
        typeof input.caption !== 'string' || input.caption.length > 1000 ||
        typeof input.folder !== 'string' || input.folder.length > 80) {
      return json({ error: 'Alt text, caption, or folder name is invalid.' }, 400);
    }
    const { data: item, error } = await owner.client.from('cms_media')
      .update({ alt: input.alt.trim(), caption: input.caption.trim(), folder: input.folder.trim() || 'uncategorized', updated_at: new Date().toISOString() })
      .eq('id', input.id)
      .select(mediaColumns)
      .single();
    if (error) {
      console.error('CMS media update failed:', error.message);
      return json({ error: 'Could not update media details.' }, 503);
    }
    await writeCmsActivity(owner.client, { actorId: owner.session.user.id, action: 'updated_media', details: { mediaId: item.id } });
    if (item.bucket === PUBLIC_BUCKET && !await triggerCmsDeployment()) {
      return json({ item, warning: 'Media details were saved, but the public site deployment could not be triggered.' }, 502);
    }
    try {
      return json({ item: { ...item, ...await resolveMediaUrls(owner.client, item) } });
    } catch (error) {
      console.error('Updated media preview URL creation failed:', error instanceof Error ? error.message : 'unknown error');
      return json({ error: 'Media details were saved, but a preview URL could not be created.' }, 503);
    }
  }

  if (input.action === 'rename') {
    if (typeof input.originalName !== 'string' || !input.originalName.trim() || input.originalName.length > 240 ||
        /[\u0000-\u001f\u007f/\\]/.test(input.originalName)) {
      return json({ error: 'Enter a file name up to 240 characters without slashes or control characters.' }, 400);
    }
    const { data: item, error } = await owner.client.from('cms_media')
      .update({ original_name: input.originalName.trim(), updated_at: new Date().toISOString() })
      .eq('id', input.id)
      .select(mediaColumns)
      .single();
    if (error) {
      console.error('CMS media rename failed:', error.message);
      return json({ error: 'Could not rename this media record.' }, 503);
    }
    await writeCmsActivity(owner.client, { actorId: owner.session.user.id, action: 'renamed_media', details: { mediaId: item.id } });
    return json({ item });
  }

  if (input.action !== 'publish') return json({ error: 'Unsupported media action.' }, 400);
  if (current.bucket === PUBLIC_BUCKET) return json({ error: 'This image is already published.' }, 409);

  const paths = getMediaStoragePaths(current);
  const uploadedPublicPaths: string[] = [];
  for (const [, storagePath] of paths) {
    const { data: privateFile, error: downloadError } = await owner.client.storage.from(PRIVATE_BUCKET).download(storagePath);
    if (downloadError || !privateFile) {
      if (uploadedPublicPaths.length) await owner.client.storage.from(PUBLIC_BUCKET).remove(uploadedPublicPaths);
      console.error('Private media publish download failed:', downloadError?.message ?? 'missing file');
      return json({ error: 'Could not read all private image variants for publishing.' }, 503);
    }
    const { error: publicUploadError } = await owner.client.storage.from(PUBLIC_BUCKET).upload(
      storagePath,
      Buffer.from(await privateFile.arrayBuffer()),
      { contentType: 'image/webp', cacheControl: '31536000', upsert: false },
    );
    if (publicUploadError) {
      if (uploadedPublicPaths.length) await owner.client.storage.from(PUBLIC_BUCKET).remove(uploadedPublicPaths);
      console.error('Public media upload failed:', publicUploadError.message);
      return json({ error: 'Could not publish all image variants.' }, 503);
    }
    uploadedPublicPaths.push(storagePath);
  }
  const { data: item, error: updateError } = await owner.client.from('cms_media')
    .update({ bucket: PUBLIC_BUCKET, updated_at: new Date().toISOString() })
    .eq('id', current.id)
    .select(mediaColumns)
    .single();
  if (updateError) {
    const { error: cleanupError } = await owner.client.storage.from(PUBLIC_BUCKET).remove(uploadedPublicPaths);
    if (cleanupError) console.error('Failed to clean up public variants after media publish error:', cleanupError.message);
    console.error('CMS media publish update failed:', updateError.message);
    return json({ error: 'Could not update the media publication state.' }, 503);
  }
  const { error: privateDeleteError } = await owner.client.storage.from(PRIVATE_BUCKET).remove(paths.map(([, storagePath]) => storagePath));
  if (privateDeleteError) console.error('Private media cleanup failed:', privateDeleteError.message);
  await writeCmsActivity(owner.client, { actorId: owner.session.user.id, action: 'published_media', details: { mediaId: item.id } });
  if (!await triggerCmsDeployment()) {
    return json({ item, warning: 'The image was published, but the public site deployment could not be triggered.' }, 502);
  }
  return json({ item: { ...item, ...await resolveMediaUrls(owner.client, item) } });
};

export const DELETE: APIRoute = async ({ request, cookies, url }) => {
  if (!isSameOrigin(request, url.origin)) return json({ error: 'Request origin could not be verified.' }, 403);
  const owner = await authorize(request, cookies);
  if (!owner.ok) return owner.response;

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'A media ID is required.' }, 400);
  const { data: item, error: lookupError } = await owner.client.from('cms_media')
    .select(mediaColumns)
    .eq('id', id)
    .maybeSingle();
  if (lookupError) {
    console.error('CMS media lookup failed:', lookupError.message);
    return json({ error: 'Could not load the media record.' }, 503);
  }
  if (!item) return json({ error: 'The media record no longer exists.' }, 404);

  const { data: assignment, error: assignmentError } = await owner.client.from('cms_media_assignments')
    .select('id,owner_type,owner_id,field_key')
    .eq('media_id', item.id)
    .limit(1)
    .maybeSingle();
  if (assignmentError) {
    console.error('CMS media assignment usage check failed:', assignmentError.message);
    return json({ error: 'Could not verify whether the image is assigned.' }, 503);
  }
  if (assignment) return json({ error: `This image is assigned to ${assignment.owner_type} / ${assignment.field_key}. Remove that assignment before deleting it.` }, 409);

  const { data: content, error: contentError } = await owner.client.from('cms_content').select('data,body');
  if (contentError) {
    console.error('CMS media usage check failed:', contentError.message);
    return json({ error: 'Could not verify whether the media is in use.' }, 503);
  }
  const { data: settings, error: settingsError } = await owner.client.from('cms_settings').select('value');
  if (settingsError) {
    console.error('CMS media settings usage check failed:', settingsError.message);
    return json({ error: 'Could not verify whether the image is used in page settings.' }, 503);
  }
  const paths = getMediaStoragePaths(item).map(([, storagePath]) => storagePath);
  const references = paths.flatMap((storagePath) => [
    storagePath,
    item.bucket === PUBLIC_BUCKET ? owner.client.storage.from(PUBLIC_BUCKET).getPublicUrl(storagePath).data.publicUrl : '',
  ]).filter(Boolean);
  const isUsed = (content ?? []).some((record) => {
    const metadata = JSON.stringify(record.data);
    return references.some((reference) => metadata.includes(reference) || record.body.includes(reference));
  }) || (settings ?? []).some((record) => {
    const value = JSON.stringify(record.value);
    return references.some((reference) => value.includes(reference));
  });
  if (isUsed) return json({ error: 'This image is referenced by saved content or page settings. Remove those references before deleting it.' }, 409);

  const { error: deleteError } = await owner.client.from('cms_media').delete().eq('id', item.id);
  if (deleteError) {
    if (deleteError.code === '23503') return json({ error: 'This image was assigned while deletion was in progress. Remove its assignment first.' }, 409);
    console.error('CMS media metadata delete failed:', deleteError.message);
    return json({ error: 'Could not remove the media record.' }, 503);
  }
  const { error: storageError } = await owner.client.storage.from(item.bucket).remove(paths);
  if (storageError) console.error('Supabase media object cleanup failed after record deletion:', storageError.message);
  await writeCmsActivity(owner.client, { actorId: owner.session.user.id, action: 'deleted_media', details: { mediaId: item.id } });
  return json({ deleted: true, warning: storageError ? 'The library record was removed, but one or more unused storage files need cleanup.' : undefined });
};
