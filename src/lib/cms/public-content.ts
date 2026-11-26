import { getCollection } from 'astro:content';

type ContentEntry = {
  id: string;
  data: {
    slug?: string;
    cmsManaged?: boolean;
  };
};

function preferCmsEntries<T extends ContentEntry>(entries: T[]) {
  const bySlug = new Map<string, T>();
  for (const entry of entries) {
    const slug = entry.data.slug ?? entry.id;
    const existing = bySlug.get(slug);
    if (!existing || (entry.data.cmsManaged && !existing.data.cmsManaged)) {
      bySlug.set(slug, entry);
    }
  }
  return [...bySlug.values()];
}

export async function getPublicProjects() {
  return preferCmsEntries(await getCollection('projects'));
}

export async function getPublicArticles() {
  return preferCmsEntries(await getCollection('blog'));
}
