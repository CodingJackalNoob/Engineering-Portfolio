import type { APIRoute } from 'astro';
import { getPublicArticles, getPublicProjects } from '../lib/cms/public-content';

export const prerender = true;

export const GET: APIRoute = async () => {
  const projects = await getPublicProjects();
  const posts = (await getPublicArticles()).filter((post) => !post.data.draft);
  const urls = [
    '',
    '/projects/',
    '/blog/',
    '/about/',
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
