import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { APIRoute } from 'astro';
import { getAdminSession, isSameOrigin } from '../../../lib/admin/auth';
import { createCmsClient, writeCmsActivity } from '../../../lib/cms/server';

export const prerender = false;

const PRIVATE_BUCKET = 'cms-media-private';
const PUBLIC_BUCKET = 'portfolio-media';
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

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

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const owner = await authorize(request, cookies);
  if (!owner.ok) return owner.response;

  const { data, error } = await owner.client
    .from('cms_media')
    .select('id,bucket,storage_path,original_name,content_type,size_bytes,alt,caption,folder,created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('CMS media query failed:', error.message);
    return json({ error: 'Could not load media records.' }, 503);
  }

  const search = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const folder = url.searchParams.get('folder')?.trim();
  let items;
  try {
    items = await Promise.all((data ?? [])
      .filter((item) => (!folder || folder === 'all' || item.folder === folder) &&
        (!search || `${item.original_name} ${item.alt} ${item.caption} ${item.folder}`.toLowerCase().includes(search)))
      .map(async (item) => {
        if (item.bucket === PUBLIC_BUCKET) {
          return { ...item, url: owner.client.storage.from(PUBLIC_BUCKET).getPublicUrl(item.storage_path).data.publicUrl };
        }
        const { data: signed, error: signedError } = await owner.client.storage
          .from(PRIVATE_BUCKET)
          .createSignedUrl(item.storage_path, 15 * 60);
        if (signedError) throw new Error(`Could not create a private media preview: ${signedError.message}`);
        return { ...item, url: signed.signedUrl };
      }));
  } catch (error) {
    console.error('CMS media preview generation failed:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'Could not create one or more media previews.' }, 503);
  }

  return json({ items, folders: [...new Set((data ?? []).map((item) => item.folder))].sort() });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request, new URL(request.url).origin)) return json({ error: 'Request origin could not be verified.' }, 403);
  const owner = await authorize(request, cookies);
  if (!owner.ok) return owner.response;

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES + 64_000) return json({ error: 'Image exceeds the 12 MB upload limit.' }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Upload must use a valid multipart form.' }, 400);
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_UPLOAD_BYTES || !allowedTypes.has(file.type)) {
    return json({ error: 'Choose a JPEG, PNG, WebP, or AVIF image no larger than 12 MB.' }, 400);
  }

  const alt = isValidText(form.get('alt'), 500);
  const caption = isValidText(form.get('caption'), 1000);
  const folder = isValidText(form.get('folder'), 80);
  if (alt === null || caption === null || folder === null) {
    return json({ error: 'Alt text, caption, or folder name exceeds its allowed length.' }, 400);
  }

  let optimized: Buffer;
  try {
    optimized = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 5 })
      .toBuffer();
  } catch (error) {
    console.warn('Media image processing rejected an upload:', error instanceof Error ? error.message : 'unknown error');
    return json({ error: 'The image could not be decoded or optimized.' }, 400);
  }
  if (optimized.byteLength > MAX_UPLOAD_BYTES) return json({ error: 'Optimized image exceeds the storage limit.' }, 413);

  const storagePath = `${randomUUID()}.webp`;
  const { error: uploadError } = await owner.client.storage.from(PRIVATE_BUCKET).upload(storagePath, optimized, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: false,
  });
  if (uploadError) {
    console.error('Supabase private media upload failed:', uploadError.message);
    return json({ error: 'Could not store the image. Verify the media storage migration.' }, 503);
  }

  const { data: item, error: insertError } = await owner.client.from('cms_media').insert({
    bucket: PRIVATE_BUCKET,
    storage_path: storagePath,
    original_name: file.name.slice(0, 240) || 'portfolio-image',
    content_type: 'image/webp',
    size_bytes: optimized.byteLength,
    alt,
    caption,
    folder: folder || 'uncategorized',
    created_by: owner.session.user.id,
  }).select('id,bucket,storage_path,original_name,content_type,size_bytes,alt,caption,folder,created_at').single();
  if (insertError) {
    await owner.client.storage.from(PRIVATE_BUCKET).remove([storagePath]);
    console.error('CMS media metadata insert failed:', insertError.message);
    return json({ error: 'Could not save image metadata.' }, 503);
  }

  await writeCmsActivity(owner.client, {
    actorId: owner.session.user.id,
    action: 'uploaded_media',
    details: { mediaId: item.id, name: item.original_name },
  });
  const { data: signed, error: signedError } = await owner.client.storage.from(PRIVATE_BUCKET).createSignedUrl(storagePath, 15 * 60);
  if (signedError) {
    console.error('Private media preview URL creation failed:', signedError.message);
    return json({ error: 'The image was uploaded, but a preview URL could not be created.' }, 503);
  }
  return json({ item: { ...item, url: signed.signedUrl } }, 201);
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  if (!isSameOrigin(request, new URL(request.url).origin)) return json({ error: 'Request origin could not be verified.' }, 403);
  const owner = await authorize(request, cookies);
  if (!owner.ok) return owner.response;

  let input: { id?: unknown; action?: unknown; alt?: unknown; caption?: unknown; folder?: unknown };
  try {
    input = await request.json() as typeof input;
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }
  if (typeof input.id !== 'string' || typeof input.action !== 'string') return json({ error: 'A media ID and action are required.' }, 400);

  const { data: current, error: lookupError } = await owner.client
    .from('cms_media')
    .select('id,bucket,storage_path,original_name,content_type,size_bytes,alt,caption,folder,created_at')
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
      .update({ alt: input.alt.trim(), caption: input.caption.trim(), folder: input.folder.trim() || 'uncategorized' })
      .eq('id', input.id)
      .select('id,bucket,storage_path,original_name,content_type,size_bytes,alt,caption,folder,created_at')
      .single();
    if (error) {
      console.error('CMS media update failed:', error.message);
      return json({ error: 'Could not update media details.' }, 503);
    }
    await writeCmsActivity(owner.client, { actorId: owner.session.user.id, action: 'updated_media', details: { mediaId: item.id } });
    const url = item.bucket === PUBLIC_BUCKET
      ? owner.client.storage.from(PUBLIC_BUCKET).getPublicUrl(item.storage_path).data.publicUrl
      : (await owner.client.storage.from(PRIVATE_BUCKET).createSignedUrl(item.storage_path, 15 * 60)).data?.signedUrl ?? null;
    return json({ item: { ...item, url } });
  }

  if (input.action !== 'publish') return json({ error: 'Unsupported media action.' }, 400);
  if (current.bucket === PUBLIC_BUCKET) return json({ error: 'This image is already published.' }, 409);

  const { data: privateFile, error: downloadError } = await owner.client.storage.from(PRIVATE_BUCKET).download(current.storage_path);
  if (downloadError || !privateFile) {
    console.error('Private media publish download failed:', downloadError?.message ?? 'missing file');
    return json({ error: 'Could not read the private image for publishing.' }, 503);
  }
  const publicBytes = Buffer.from(await privateFile.arrayBuffer());
  const { error: publicUploadError } = await owner.client.storage.from(PUBLIC_BUCKET).upload(current.storage_path, publicBytes, {
    contentType: 'image/webp',
    cacheControl: '31536000',
    upsert: true,
  });
  if (publicUploadError) {
    console.error('Public media upload failed:', publicUploadError.message);
    return json({ error: 'Could not publish the image.' }, 503);
  }
  const { data: item, error: updateError } = await owner.client.from('cms_media')
    .update({ bucket: PUBLIC_BUCKET })
    .eq('id', current.id)
    .select('id,bucket,storage_path,original_name,content_type,size_bytes,alt,caption,folder,created_at')
    .single();
  if (updateError) {
    await owner.client.storage.from(PUBLIC_BUCKET).remove([current.storage_path]);
    console.error('CMS media publish update failed:', updateError.message);
    return json({ error: 'Could not update the media publication state.' }, 503);
  }
  const { error: privateDeleteError } = await owner.client.storage.from(PRIVATE_BUCKET).remove([current.storage_path]);
  if (privateDeleteError) console.error('Private media cleanup failed:', privateDeleteError.message);
  await writeCmsActivity(owner.client, { actorId: owner.session.user.id, action: 'published_media', details: { mediaId: item.id } });
  return json({ item: { ...item, url: owner.client.storage.from(PUBLIC_BUCKET).getPublicUrl(item.storage_path).data.publicUrl } });
};

export const DELETE: APIRoute = async ({ request, cookies, url }) => {
  if (!isSameOrigin(request, url.origin)) return json({ error: 'Request origin could not be verified.' }, 403);
  const owner = await authorize(request, cookies);
  if (!owner.ok) return owner.response;

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'A media ID is required.' }, 400);
  const { data: item, error: lookupError } = await owner.client.from('cms_media')
    .select('id,bucket,storage_path,original_name')
    .eq('id', id)
    .maybeSingle();
  if (lookupError) {
    console.error('CMS media lookup failed:', lookupError.message);
    return json({ error: 'Could not load the media record.' }, 503);
  }
  if (!item) return json({ error: 'The media record no longer exists.' }, 404);

  const { data: content, error: contentError } = await owner.client.from('cms_content').select('data,body');
  if (contentError) {
    console.error('CMS media usage check failed:', contentError.message);
    return json({ error: 'Could not verify whether the media is in use.' }, 503);
  }
  const publicUrl = item.bucket === PUBLIC_BUCKET
    ? owner.client.storage.from(PUBLIC_BUCKET).getPublicUrl(item.storage_path).data.publicUrl
    : item.storage_path;
  const isUsed = (content ?? []).some((record) => {
    const metadata = JSON.stringify(record.data);
    return metadata.includes(item.storage_path) || metadata.includes(publicUrl) || record.body.includes(publicUrl);
  });
  if (isUsed) return json({ error: 'This image is referenced by saved content. Remove those references before deleting it.' }, 409);

  const { error: storageError } = await owner.client.storage.from(item.bucket).remove([item.storage_path]);
  if (storageError) {
    console.error('Supabase media delete failed:', storageError.message);
    return json({ error: 'Could not delete the stored image.' }, 503);
  }
  const { error: deleteError } = await owner.client.from('cms_media').delete().eq('id', item.id);
  if (deleteError) {
    console.error('CMS media metadata delete failed:', deleteError.message);
    return json({ error: 'The file was removed, but its media record could not be deleted.' }, 503);
  }
  await writeCmsActivity(owner.client, { actorId: owner.session.user.id, action: 'deleted_media', details: { mediaId: item.id } });
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
};
