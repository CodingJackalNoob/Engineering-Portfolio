import { z } from 'zod';

const httpsUrl = z.url().refine((value) => new URL(value).protocol === 'https:');
const linkUrl = httpsUrl.optional().or(z.literal(''));
const imageSource = z.string().refine((value) => {
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
});
const imageSchema = z.object({
  src: imageSource,
  alt: z.string().default(''),
  caption: z.string().optional(),
});
const videoEmbedUrl = z.url().refine((value) => {
  const parsed = new URL(value);
  return (
    (parsed.hostname === 'www.youtube-nocookie.com' && parsed.pathname.startsWith('/embed/')) ||
    (parsed.hostname === 'www.youtube.com' && parsed.pathname.startsWith('/embed/')) ||
    (parsed.hostname === 'player.vimeo.com' && parsed.pathname.startsWith('/video/'))
  );
}, 'Use an embed URL from YouTube or Vimeo.').optional();

export const projectDataSchema = z.object({
  title: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(320),
  overview: z.string().max(12000).optional(),
  date: z.coerce.date(),
  updatedDate: z.coerce.date().optional(),
  status: z.enum(['Planning', 'In Progress', 'Completed', 'Paused']),
  category: z.enum([
    'Robotics',
    'Mechanical Design',
    'PCB Design',
    'Embedded Systems',
    'Software',
    'Research & Experiments',
  ]),
  technologies: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  coverImage: imageSource.optional(),
  coverAlt: z.string().optional(),
  images: z.array(imageSchema).max(40).default([]),
  featured: z.boolean().default(false),
  links: z.object({
    github: linkUrl,
    documentation: linkUrl,
    video: linkUrl,
    external: linkUrl,
  }).default({}),
  startDate: z.coerce.date().optional(),
  completionDate: z.coerce.date().optional(),
  designProcess: z.string().max(20000).optional(),
  hardware: z.string().max(20000).optional(),
  software: z.string().max(20000).optional(),
  progress: z.string().max(12000).optional(),
  challenges: z.string().max(20000).optional(),
  futureImprovements: z.string().max(12000).optional(),
  videoEmbed: videoEmbedUrl,
});

export const articleDataSchema = z.object({
  title: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(320),
  subtitle: z.string().max(240).optional(),
  date: z.coerce.date(),
  updatedDate: z.coerce.date().optional(),
  category: z.string().trim().min(1).max(80),
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  coverImage: imageSource.optional(),
  coverAlt: z.string().optional(),
  readingTime: z.number().positive().optional(),
  featured: z.boolean().default(false),
  draft: z.boolean().default(false),
  seoTitle: z.string().max(160).optional(),
  seoDescription: z.string().max(320).optional(),
  videoEmbed: videoEmbedUrl,
});

export const contentMutationSchema = z.object({
  id: z.uuid().optional(),
  type: z.enum(['project', 'article']),
  state: z.enum(['draft', 'scheduled', 'published']),
  scheduledAt: z.iso.datetime().optional().nullable(),
  data: z.record(z.string(), z.unknown()),
  body: z.string().max(500_000),
});

export function parseContentData(type: 'project' | 'article', data: Record<string, unknown>) {
  const schema = type === 'project' ? projectDataSchema : articleDataSchema;
  return schema.parse(data);
}

export function isValidSlug(slug: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
