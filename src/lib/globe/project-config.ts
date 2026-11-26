/**
 * Confirmed geographic coordinates for project globe pins, keyed by stable slug.
 * Leave a project out until its real location is known; the globe UI can still
 * preview it from the project list without implying a fabricated location.
 */
export const projectGlobeLocations: Record<string, { latitude: number; longitude: number }> = {};

export type GlobeProjectSource = {
  id: string;
  slug: string;
  title: string;
  category: string;
  description: string;
  technologies: string[];
  image?: string;
  imageAlt?: string;
};

export function toGlobeProject(project: GlobeProjectSource) {
  const classification = `${project.category} ${project.technologies.join(' ')}`.toLowerCase();
  const categories = new Set<string>();
  if (/mechanical|robot|cad|mechanism|plotter|electromagnet/.test(classification)) categories.add('mechanism');
  if (/embedded|electronics|software|arduino|sensor|\bc\+\+\b|programming/.test(classification)) categories.add('signal');
  if (categories.size > 1) categories.add('system');

  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    category: project.category,
    description: project.description,
    technologies: project.technologies,
    image: project.image ?? '',
    imageAlt: project.imageAlt ?? `${project.title} project image`,
    categories: [...categories],
    location: projectGlobeLocations[project.slug] ?? null,
    href: `/projects/${project.slug}/`,
  };
}
