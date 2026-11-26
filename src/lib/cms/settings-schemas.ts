import { z } from 'zod';

const optionalUrl = z.url().refine((value) => new URL(value).protocol === 'https:')
  .optional().or(z.literal('')).transform((value) => value || undefined);

export const aboutSettingsSchema = z.object({
  biography: z.string().max(8000).default(''),
  aspiration: z.string().max(3000).default(''),
  profilePhoto: optionalUrl,
  profilePhotoAlt: z.string().max(500).default(''),
  education: z.array(z.object({
    institution: z.string().max(180),
    program: z.string().max(180),
    years: z.string().max(80),
    detail: z.string().max(1500),
  })).max(20).default([]),
  skills: z.array(z.string().max(80)).max(60).default([]),
  experience: z.array(z.object({
    role: z.string().max(180),
    organization: z.string().max(180),
    dates: z.string().max(80),
    description: z.string().max(1500),
  })).max(30).default([]),
  achievements: z.array(z.string().max(500)).max(40).default([]),
  activities: z.array(z.string().max(500)).max(40).default([]),
  socialLinks: z.object({
    github: optionalUrl,
    linkedin: optionalUrl,
    website: optionalUrl,
  }).default(() => ({ github: undefined, linkedin: undefined, website: undefined })),
});

export const siteSettingsSchema = z.object({
  siteName: z.string().trim().min(1).max(120),
  siteDescription: z.string().trim().min(1).max(320),
  socialImage: optionalUrl,
});

export const settingsMutationSchema = z.object({
  key: z.enum(['about', 'site']),
  value: z.record(z.string(), z.unknown()),
});
