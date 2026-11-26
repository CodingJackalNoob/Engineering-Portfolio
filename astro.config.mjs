import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import vercel from '@astrojs/vercel';
import { unified } from '@astrojs/markdown-remark';
import rehypeSanitize from 'rehype-sanitize';

export default defineConfig({
  integrations: [mdx()],
  markdown: { processor: unified({ rehypePlugins: [rehypeSanitize] }) },
  output: 'server',
  adapter: vercel(),
  trailingSlash: 'ignore',
});
