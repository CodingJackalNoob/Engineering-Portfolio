# Engineering Portfolio

A static Astro portfolio and technical blog for Jainavaneeth Kumarashankar.

## Development

```bash
npm install
npm run dev
```

Create a production build with:

```bash
npm run build
npm run preview
```

## Publishing a project

1. Create `content/projects/<slug>.mdx`.
2. Add required frontmatter:
   - `title`
   - `description`
   - `date`
   - `status` (`Completed`, `In Progress`, or `Paused`)
   - `category`
3. Set `slug` explicitly or let it default to the filename.
4. Set `featured: true` to display the project on the homepage.
5. Add an optional overview and technologies array.
6. Write the project content below the frontmatter using Markdown/MDX.
7. Commit and push the file. Vercel will automatically generate `/projects/<slug>/`.

Project categories are:

- `Robotics`
- `Mechanical Design`
- `PCB Design`
- `Embedded Systems`
- `Software`
- `Research & Experiments`

## Adding project images

Place project images in `public/images/projects/<slug>/`, then reference them from frontmatter or MDX:

```md
![A descriptive image description](/images/projects/wizard-chess/assembly.jpg)
```

For cover and gallery metadata, use paths such as `/images/projects/wizard-chess/cover.jpg`.
Always provide a meaningful `alt` text. Missing cover images are handled with a non-placeholder label instead of a broken image.

## Publishing a blog post

1. Create `content/blog/<slug>.mdx`.
2. Add frontmatter for `title`, `description`, `date`, `category`, `tags`, and optional `readingTime`.
3. Set `featured: true` if it should be featured.
4. Set `draft: true` to keep the post unpublished.
5. Set `draft: false` or remove the field to publish it.
6. Write the article using Markdown/MDX. Level-two and level-three headings are collected into the table of contents.
7. Commit and push the file. Vercel generates `/blog/<slug>/`.

## Editing existing content

Edit an existing `.mdx` file in `content/projects/` or `content/blog/`. Change `status`, `featured`, `draft`, dates, technologies, tags, and metadata directly in frontmatter.

## Image and metadata conventions

- Keep image files under `public/images/projects/` or `public/images/blog/`.
- Required frontmatter is validated during `npm run build`.
- Invalid metadata stops the build instead of silently displaying broken content.
- There is no public admin interface or database.
