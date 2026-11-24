import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async () => {
  const projects = await getCollection('projects');
  const posts = (await getCollection('blog')).filter((post) => !post.data.draft);
  const urls = [
    '',
    '/projects/',
    '/blog/',
    '/about/',
    '/contact/',
    ...projects.map((project) => `/projects/${project.data.slug ?? project.id}/`),
    ...posts.map((post) => `/blog/${post.data.slug ?? post.id}/`),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>https://engineering-portfolio.vercel.app${url}</loc></url>`).join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
