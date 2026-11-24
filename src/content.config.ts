import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const projectStatus = z.enum(['Completed', 'In Progress', 'Paused']);

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
      github: z.string().url().optional(),
      documentation: z.string().url().optional(),
      video: z.string().url().optional(),
      external: z.string().url().optional(),
    }).default({}),
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
  }),
});

export const collections = { projects, blog };
