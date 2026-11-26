import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { publicMediaAssignmentsSchema } from './media';
import { aboutSettingsSchema, siteSettingsSchema } from './settings-schemas';

async function readGeneratedFile(fileName: string) {
  try {
    return await readFile(path.join(process.cwd(), 'content/.cms-generated', fileName), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function getGeneratedAbout() {
  const contents = await readGeneratedFile('about.json');
  if (!contents) return null;
  const result = aboutSettingsSchema.safeParse(JSON.parse(contents));
  if (!result.success) throw new Error('Generated About content does not match the CMS schema.');
  return result.data;
}

export async function getGeneratedSiteSettings() {
  const contents = await readGeneratedFile('site.json');
  if (!contents) return null;
  const result = siteSettingsSchema.safeParse(JSON.parse(contents));
  if (!result.success) throw new Error('Generated site settings do not match the CMS schema.');
  return result.data;
}

export async function getGeneratedMediaAssignments() {
  const contents = await readGeneratedFile('media.json');
  if (!contents) return [];
  const result = publicMediaAssignmentsSchema.safeParse(JSON.parse(contents));
  if (!result.success) throw new Error('Generated media assignments do not match the CMS schema.');
  return result.data;
}
