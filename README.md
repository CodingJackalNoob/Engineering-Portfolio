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

The homepage globe reads project titles, descriptions, categories, technologies, images, and links from these project records. Confirmed map coordinates are kept separately in `src/lib/globe/project-config.ts`, keyed by project slug as `{ latitude, longitude }`. Add coordinates only when the project has a real location to show; projects without one remain available in the globe's project preview list without a map pin.

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
- The site has an owner-only admin interface backed by Supabase.

## Admin Media Library

The owner-only `/admin/media` page stores uploaded images in Supabase Storage. The server validates and decodes each upload, creates WebP responsive variants, and keeps the original out of the public bucket. Large source screenshots are optimized in the browser before upload so their request stays below Vercel's [4.5 MB function request limit](https://vercel.com/docs/functions/limitations); the 12 MB source image limit is unchanged. A public image must be explicitly published before a published page can use it. The browser talks only to same-origin admin API routes; the Supabase service role key stays on the server.

Set `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in the server environment. Apply the media schema migrations in order, including `20261127010000_extend_cms_media_assignments.sql`, before opening the library. Do not edit migrations that have already been applied; add a new migration for later schema changes. The service role key must never use a `PUBLIC_` prefix.

The reusable `MediaFieldEditor` component binds an ordered set of media to an owner and field key. For example, a future page section can assign its assets with `<MediaFieldEditor label="Diagram" ownerType="widget" ownerId="motor-demo" fieldKey="diagram" />`. On a public page, load assignments with `getGeneratedMediaAssignments()`, select that owner/field using `getMediaFieldAssignments(...)`, then render each item with `ResponsiveMediaImage`. Keep owner IDs stable so deployments resolve the same assignments. The homepage moments field demonstrates per-image title, date, and visibility metadata; article body images use `cms-media:<media-id>` markers and are resolved during CMS sync.

Legacy project and article image URLs remain as a fallback while those records are migrated to assignments. The `/admin/about` editor exposes profile and gallery assignments; the homepage hero and moments assignments are available in `/admin/media`.
