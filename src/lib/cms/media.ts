import { z } from 'zod';

export const mediaOwnerTypeSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
export const mediaFieldKeySchema = z.string().regex(/^[a-z][a-z0-9._-]{0,119}$/);

export const mediaAssignmentItemSchema = z.object({
  mediaId: z.uuid(),
  alt: z.string().max(500).default(''),
  caption: z.string().max(1000).default(''),
  focalX: z.number().min(0).max(1).default(0.5),
  focalY: z.number().min(0).max(1).default(0.5),
  displaySettings: z.record(z.string().max(80), z.unknown()).default({}),
});

export const mediaAssignmentGroupSchema = z.object({
  ownerType: mediaOwnerTypeSchema,
  ownerId: z.string().trim().min(1).max(200),
  fieldKey: mediaFieldKeySchema,
  items: z.array(mediaAssignmentItemSchema).max(80),
});

export type MediaAssignmentItem = z.infer<typeof mediaAssignmentItemSchema>;

export const publicMediaAssignmentSchema = z.object({
  ownerType: mediaOwnerTypeSchema,
  ownerId: z.string().min(1).max(200),
  fieldKey: mediaFieldKeySchema,
  mediaId: z.uuid(),
  position: z.number().int().nonnegative(),
  alt: z.string(),
  caption: z.string(),
  focalX: z.number().min(0).max(1),
  focalY: z.number().min(0).max(1),
  displaySettings: z.record(z.string(), z.unknown()),
  media: z.object({
    url: z.url(),
    srcSet: z.string(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    contentType: z.literal('image/webp'),
  }),
});

export const publicMediaAssignmentsSchema = z.array(publicMediaAssignmentSchema);
export type PublicMediaAssignment = z.infer<typeof publicMediaAssignmentSchema>;

export function getMediaFieldAssignments(
  assignments: PublicMediaAssignment[],
  ownerType: string,
  ownerId: string,
  fieldKey: string,
) {
  return assignments
    .filter((item) => item.ownerType === ownerType && item.ownerId === ownerId && item.fieldKey === fieldKey)
    .sort((a, b) => a.position - b.position);
}

export const mediaFieldDefinitions = {
  homepageHero: { ownerType: 'page', ownerId: 'home', fieldKey: 'hero', multiple: false },
  homepageMoments: { ownerType: 'page', ownerId: 'home', fieldKey: 'moments', multiple: true },
  aboutProfile: { ownerType: 'page', ownerId: 'about', fieldKey: 'profile', multiple: false },
  projectCover: { ownerType: 'project', fieldKey: 'cover', multiple: false },
  projectGallery: { ownerType: 'project', fieldKey: 'gallery', multiple: true },
  articleCover: { ownerType: 'article', fieldKey: 'cover', multiple: false },
  articleInline: { ownerType: 'article', fieldKey: 'inline', multiple: true },
} as const;
