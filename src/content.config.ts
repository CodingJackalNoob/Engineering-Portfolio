import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';

const projectStatus = z.enum(['Planning', 'Completed', 'In Progress', 'Paused']);

const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './content/projects' }),
  schema: z.object({
    title: z.string().min(1),
    slug: z.string().min(1).optional(),
    description: z.string().min(1),
    overview: z.string().min(1).optional(),
    date: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    status: projectStatus,
    category: z.enum([
      'Robotics',
      'Mechanical Design',
      'PCB Design',
      'Embedded Systems',
      'Software',
      'Research & Experiments',
    ]),
    technologies: z.array(z.string()).default([]),
    coverImage: z.string().optional(),
    coverAlt: z.string().optional(),
    images: z.array(z.object({
      src: z.string(),
      alt: z.string(),
      caption: z.string().optional(),
    })).default([]),
    featured: z.boolean().default(false),
    links: z.object({
      github: z.url().optional(),
      documentation: z.url().optional(),
      video: z.url().optional(),
      external: z.url().optional(),
    }).default({}),
    startDate: z.coerce.date().optional(),
    completionDate: z.coerce.date().optional(),
    designProcess: z.string().optional(),
    hardware: z.string().optional(),
    software: z.string().optional(),
    progress: z.string().optional(),
    challenges: z.string().optional(),
    futureImprovements: z.string().optional(),
    videoEmbed: z.url().optional(),
    cmsManaged: z.boolean().optional(),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './content/blog' }),
  schema: z.object({
    title: z.string().min(1),
    slug: z.string().min(1).optional(),
    description: z.string().min(1),
    date: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    category: z.string().min(1),
    tags: z.array(z.string()).default([]),
    coverImage: z.string().optional(),
    coverAlt: z.string().optional(),
    readingTime: z.number().positive().optional(),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
    subtitle: z.string().optional(),
    seoTitle: z.string().optional(),
    seoDescription: z.string().optional(),
    videoEmbed: z.url().optional(),
    cmsManaged: z.boolean().optional(),
  }),
});

export const collections = { projects, blog };
