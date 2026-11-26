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

for (const directory of [...Object.values(generated), generatedSettings]) {
  await rm(directory, { recursive: true, force: true });
}

if (process.env.CMS_CONTENT_SOURCE !== 'supabase') {
  process.exit(0);
}

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('CMS_CONTENT_SOURCE=supabase requires PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}

const query = new URL('/rest/v1/cms_content', supabaseUrl);
query.searchParams.set('select', 'content_type,slug,data,body');
query.searchParams.set('publication_state', 'eq.published');
query.searchParams.set('content_type', 'in.(project,article)');
const response = await fetch(query, {
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  },
});
if (!response.ok) {
  throw new Error(`Could not load published CMS content (${response.status}): ${await response.text()}`);
}

const rows = await response.json();
if (!Array.isArray(rows)) throw new Error('The CMS content response was not a list.');

for (const row of rows) {
  if (!['project', 'article'].includes(row.content_type) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug)) {
    throw new Error('The CMS returned a content item with an unsupported type or slug.');
  }

  const directory = generated[row.content_type];
  const data = {
    ...row.data,
    slug: row.slug,
    cmsManaged: true,
    ...(row.content_type === 'article' ? { draft: false } : {}),
  };
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${row.slug}.md`),
    `---\n${JSON.stringify(data, null, 2)}\n---\n\n${row.body ?? ''}`,
    'utf8',
  );
}

for (const directory of Object.values(generated)) {
  try {
    if ((await readdir(directory)).length === 0) await rm(directory, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const settingsQuery = new URL('/rest/v1/cms_settings', supabaseUrl);
settingsQuery.searchParams.set('select', 'key,value');
settingsQuery.searchParams.set('key', 'in.(about,site)');
const settingsResponse = await fetch(settingsQuery, {
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  },
});
if (!settingsResponse.ok) {
  throw new Error(`Could not load CMS settings (${settingsResponse.status}): ${await settingsResponse.text()}`);
}
const settingsRows = await settingsResponse.json();
if (!Array.isArray(settingsRows)) throw new Error('The CMS settings response was not a list.');
if (settingsRows.length) {
  await mkdir(generatedSettings, { recursive: true });
  for (const row of settingsRows) {
    if (row.key === 'about' || row.key === 'site') {
      await writeFile(path.join(generatedSettings, `${row.key}.json`), JSON.stringify(row.value), 'utf8');
    }
  }
}
