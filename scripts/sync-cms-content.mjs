import 'dotenv/config';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = {
  project: path.join(root, 'content/projects/.cms-generated'),
  article: path.join(root, 'content/blog/.cms-generated'),
};
const generatedSettings = path.join(root, 'content/.cms-generated');
const publishedContentIds = new Set();

for (const directory of [...Object.values(generated), generatedSettings]) {
  await rm(directory, { recursive: true, force: true });
}

if (process.env.CMS_CONTENT_SOURCE !== 'supabase') process.exit(0);

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('CMS_CONTENT_SOURCE=supabase requires PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}
const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };

const query = new URL('/rest/v1/cms_content', supabaseUrl);
query.searchParams.set('select', 'id,content_type,slug,data,body');
query.searchParams.set('publication_state', 'eq.published');
query.searchParams.set('content_type', 'in.(project,article)');
const response = await fetch(query, { headers });
if (!response.ok) throw new Error(`Could not load published CMS content (${response.status}): ${await response.text()}`);
const rows = await response.json();
if (!Array.isArray(rows)) throw new Error('The CMS content response was not a list.');

for (const row of rows) {
  if (!['project', 'article'].includes(row.content_type) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug)) {
    throw new Error('The CMS returned a content item with an unsupported type or slug.');
  }
  publishedContentIds.add(row.id);
}

const settingsQuery = new URL('/rest/v1/cms_settings', supabaseUrl);
settingsQuery.searchParams.set('select', 'key,value');
settingsQuery.searchParams.set('key', 'in.(about,site)');
const settingsResponse = await fetch(settingsQuery, { headers });
if (!settingsResponse.ok) throw new Error(`Could not load CMS settings (${settingsResponse.status}): ${await settingsResponse.text()}`);
const settingsRows = await settingsResponse.json();
if (!Array.isArray(settingsRows)) throw new Error('The CMS settings response was not a list.');

const assignmentQuery = new URL('/rest/v1/cms_media_assignments', supabaseUrl);
assignmentQuery.searchParams.set('select', 'owner_type,owner_id,field_key,media_id,position,alt,caption,focal_x,focal_y,display_settings');
assignmentQuery.searchParams.set('order', 'owner_type,owner_id,field_key,position');
const assignmentResponse = await fetch(assignmentQuery, { headers });
let assignments = [];
if (!assignmentResponse.ok) {
  const errorBody = await assignmentResponse.text();
  let missingAssignmentTable = false;
  try {
    const error = JSON.parse(errorBody);
    missingAssignmentTable = error.code === 'PGRST205' && error.message?.includes('cms_media_assignments');
  } catch {
    // Keep the original response below for actionable errors.
  }
  if (!missingAssignmentTable) {
    throw new Error(`Could not load CMS media assignments (${assignmentResponse.status}): ${errorBody}`);
  }
  console.warn('CMS media assignments are unavailable; apply the media assignment migration to enable assigned images. Existing URL-based images will continue to render.');
} else {
  assignments = await assignmentResponse.json();
}
if (!Array.isArray(assignments)) throw new Error('The CMS media assignment response was not a list.');

const publicAssignments = assignments.filter((assignment) => {
  if (assignment.owner_type === 'project' || assignment.owner_type === 'article') return publishedContentIds.has(assignment.owner_id);
  return true;
});
const mediaIds = [...new Set(publicAssignments.map((assignment) => assignment.media_id))];
let mediaById = new Map();
if (mediaIds.length) {
  const mediaQuery = new URL('/rest/v1/cms_media', supabaseUrl);
  mediaQuery.searchParams.set('select', 'id,bucket,storage_path,content_type,width,height,variants');
  mediaQuery.searchParams.set('id', `in.(${mediaIds.join(',')})`);
  const mediaResponse = await fetch(mediaQuery, { headers });
  if (!mediaResponse.ok) throw new Error(`Could not load assigned CMS media (${mediaResponse.status}): ${await mediaResponse.text()}`);
  const mediaRows = await mediaResponse.json();
  if (!Array.isArray(mediaRows)) throw new Error('The CMS media response was not a list.');
  mediaById = new Map(mediaRows.map((media) => [media.id, media]));
}

const generatedAssignments = publicAssignments.map((assignment) => {
  const media = mediaById.get(assignment.media_id);
  if (!media) throw new Error(`Media assignment for ${assignment.owner_type}/${assignment.owner_id} references a missing media record.`);
  if (media.bucket !== 'portfolio-media') throw new Error(`Published ${assignment.owner_type} media assignments must reference published Media Library assets.`);
  if (media.content_type !== 'image/webp') throw new Error(`Media ${media.id} is not stored as optimized WebP.`);

  const variants = media.variants && typeof media.variants === 'object' && !Array.isArray(media.variants)
    ? Object.entries(media.variants)
        .map(([width, storagePath]) => [Number(width), storagePath])
        .filter(([width, storagePath]) => Number.isSafeInteger(width) && width > 0 && typeof storagePath === 'string')
        .sort(([a], [b]) => a - b)
    : [];
  if (!variants.length && typeof media.storage_path === 'string') variants.push([Number(media.width) || 0, media.storage_path]);
  const toPublicUrl = (storagePath) => new URL(
    `/storage/v1/object/public/portfolio-media/${storagePath.split('/').map(encodeURIComponent).join('/')}`,
    supabaseUrl,
  ).toString();
  const resolvedVariants = variants.map(([width, storagePath]) => ({ width, url: toPublicUrl(storagePath) }));
  const largest = resolvedVariants.at(-1);
  if (!largest) throw new Error(`Media ${media.id} has no storage variants.`);

  return {
    ownerType: assignment.owner_type,
    ownerId: assignment.owner_id,
    fieldKey: assignment.field_key,
    mediaId: assignment.media_id,
    position: assignment.position,
    alt: assignment.alt,
    caption: assignment.caption,
    focalX: Number(assignment.focal_x),
    focalY: Number(assignment.focal_y),
    displaySettings: assignment.display_settings ?? {},
    media: {
      url: largest.url,
      srcSet: resolvedVariants.filter((variant) => variant.width > 0).map((variant) => `${variant.url} ${variant.width}w`).join(', '),
      width: media.width,
      height: media.height,
      contentType: media.content_type,
    },
  };
});

await mkdir(generatedSettings, { recursive: true });
for (const row of settingsRows) {
  if (row.key === 'about' || row.key === 'site') {
    await writeFile(path.join(generatedSettings, `${row.key}.json`), JSON.stringify(row.value), 'utf8');
  }
}
await writeFile(path.join(generatedSettings, 'media.json'), JSON.stringify(generatedAssignments), 'utf8');

for (const row of rows) {
  const data = {
    ...row.data,
    slug: row.slug,
    cmsManaged: true,
    cmsId: row.id,
    ...(row.content_type === 'article' ? { draft: false } : {}),
  };
  let body = row.body ?? '';
  if (row.content_type === 'article') {
    body = body.replace(/!\[([^\]]*)\]\(cms-media:([0-9a-f-]{36})\)/gi, (_marker, markerAlt, mediaId) => {
      const assignment = generatedAssignments.find((item) => item.ownerType === 'article' && item.ownerId === row.id && item.fieldKey === 'inline' && item.mediaId === mediaId);
      if (!assignment) throw new Error(`Inline article image ${mediaId} has no published Media Library assignment.`);
      const alt = markerAlt || assignment.alt || '';
      const caption = assignment.caption ? `\n\n*${assignment.caption.replaceAll('*', '\\*')}*` : '';
      return `![${alt.replaceAll(']', '\\]')}](${assignment.media.url})${caption}`;
    });
  }
  const directory = generated[row.content_type];
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${row.slug}.md`), `---\n${JSON.stringify(data, null, 2)}\n---\n\n${body}`, 'utf8');
}

for (const directory of Object.values(generated)) {
  try {
    if ((await readdir(directory)).length === 0) await rm(directory, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
