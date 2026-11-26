import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before importing local content.');
}

async function findMarkdown(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name === '.cms-generated') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findMarkdown(fullPath));
    else if (/\.(md|mdx)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const items = [];
for (const [contentType, folder] of [['project', 'projects'], ['article', 'blog']]) {
  const directory = path.join(root, 'content', folder);
  for (const file of await findMarkdown(directory)) {
    const parsed = matter(await readFile(file, 'utf8'));
    const slug = String(parsed.data.slug ?? path.basename(file).replace(/\.(md|mdx)$/, ''));
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      throw new Error(`Invalid slug "${slug}" in ${path.relative(root, file)}.`);
    }

    const data = { ...parsed.data, slug };
    const isDraft = contentType === 'article' && data.draft === true;
    items.push({
      content_type: contentType,
      slug,
      data,
      body: parsed.content.trim(),
      publication_state: isDraft ? 'draft' : 'published',
      scheduled_at: null,
    });
  }
}

if (items.length === 0) {
  console.log('No local project or article content found to import.');
  process.exit(0);
}

const endpoint = new URL('/rest/v1/cms_content', supabaseUrl);
endpoint.searchParams.set('on_conflict', 'content_type,slug');
const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=ignore-duplicates,return=minimal',
  },
  body: JSON.stringify(items),
});
if (!response.ok) {
  throw new Error(`Could not import local content (${response.status}): ${await response.text()}`);
}

console.log(`Imported ${items.length} local content record(s). Existing CMS records were left unchanged.`);
