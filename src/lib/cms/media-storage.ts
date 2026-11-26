import type { SupabaseClient } from '@supabase/supabase-js';

export interface CmsMediaStorageRecord {
  id: string;
  bucket: string;
  storage_path: string;
  variants: unknown;
  width: number | null;
  height: number | null;
}

export interface ResolvedMediaUrls {
  url: string;
  srcSet: string;
  variants: Array<{ width: number; url: string }>;
}

export function getMediaStoragePaths(media: CmsMediaStorageRecord) {
  const paths = new Map<number, string>();
  if (media.variants && typeof media.variants === 'object' && !Array.isArray(media.variants)) {
    for (const [widthLabel, storagePath] of Object.entries(media.variants)) {
      const width = Number(widthLabel);
      if (Number.isSafeInteger(width) && width > 0 && typeof storagePath === 'string') paths.set(width, storagePath);
    }
  }
  paths.set(media.width ?? Math.max(0, ...paths.keys()), media.storage_path);
  return [...paths].sort(([a], [b]) => a - b);
}

export async function resolveMediaUrls(
  client: SupabaseClient,
  media: CmsMediaStorageRecord,
  expiresIn = 15 * 60,
): Promise<ResolvedMediaUrls> {
  const paths = getMediaStoragePaths(media);
  const resolved = await Promise.all(paths.map(async ([width, storagePath]) => {
    if (media.bucket === 'portfolio-media') {
      return { width, url: client.storage.from(media.bucket).getPublicUrl(storagePath).data.publicUrl };
    }
    const { data, error } = await client.storage.from(media.bucket).createSignedUrl(storagePath, expiresIn);
    if (error || !data?.signedUrl) throw new Error(`Could not create a media preview URL: ${error?.message ?? 'missing URL'}`);
    return { width, url: data.signedUrl };
  }));
  const largest = resolved.at(-1);
  if (!largest) throw new Error('The media record has no usable image path.');
  return {
    url: largest.url,
    srcSet: resolved.filter(({ width }) => width > 0).map(({ width, url }) => `${url} ${width}w`).join(', '),
    variants: resolved,
  };
}
