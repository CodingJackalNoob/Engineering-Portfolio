# Private admin setup

The admin routes run on Vercel's server runtime. Public portfolio routes remain prerendered static pages.

## Configure Supabase Auth

1. Create a Supabase project and enable email/password sign-in.
2. Create and confirm the owner account using the email that will be set as `ADMIN_EMAIL`.
3. Disable public sign-ups after creating the owner account.
4. Copy the project URL and publishable/anon key from the Supabase API settings.

## Configure environment variables

Copy `.env.example` to `.env` for local development and set the values below. Add the same variables to the Vercel project for the relevant deployment environments. Do not commit `.env` or paste secret values into source files.

| Variable | Purpose |
| --- | --- |
| `PUBLIC_SITE_URL` | Canonical deployment origin, including `https://`; used to validate state-changing request origins. |
| `PUBLIC_SUPABASE_URL` | Supabase project URL. |
| `PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable/anon key used by the server-side Auth client. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase key used for CMS operations and the persistent login rate limiter. |
| `ADMIN_EMAIL` | Exact email address allowed into the admin workspace. |
| `ADMIN_SESSION_SECRET` | Random secret of at least 32 bytes used to sign the fixed-expiry admin session cookie. |

Generate the session secret locally with `openssl rand -base64 48`; store it only in local environment configuration and Vercel's encrypted environment-variable settings. Login is intentionally unavailable when Supabase, session signing, site-origin, or the database-backed rate limiter is unavailable.

Login attempts are limited in the Supabase database using an atomic PostgreSQL function: 20 attempts per IP address and 5 attempts per normalized account email in a rolling 15-minute window. The limiter stores only HMACs of those identifiers, requires the Supabase service-role key, and fails closed if the database or limiter function is unavailable. Apply the rate-limiter migration along with the other Supabase migrations before enabling admin sign-in.

## Connect persistent content

1. Apply all SQL migrations in `supabase/migrations/` to the Supabase project, in filename order.
2. Import the existing local MDX records once with `npm run cms:import`. This command uses `PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the process environment and never overwrites an existing CMS record.
3. Set `CMS_CONTENT_SOURCE=supabase` in the Vercel build environment. The build downloads only published rows into ignored, temporary Markdown files; existing local content stays in source control and matching imported CMS records take precedence at build time.
4. Create a Vercel deployment hook and set its URL as `VERCEL_DEPLOY_HOOK_URL`. Publishing or deleting an already-published record triggers a new static-site build.
5. Set `CRON_SECRET` to a random secret of at least 32 characters so Vercel's scheduled-content endpoint can promote due articles. The Vercel Cron schedule is configured for every 15 minutes.

The admin API uses the Supabase service-role key only on the server and only after checking the signed owner session. Do not expose this key in any `PUBLIC_` variable or browser code.

## Image handling

The media migration creates a private staging bucket and a public delivery bucket. Uploads accept JPEG, PNG, WebP, or AVIF up to 12 MB, are resized and converted to WebP, and remain private until explicitly published. Videos are embedded from approved YouTube/Vimeo embed URLs rather than uploaded.

## Current implementation stages

- Owner-only sign-in, fixed 12-hour HTTP-only session, CSRF origin checks, persistent per-IP/account rate limits, noindex headers, and responsive private dashboard shell.
- Supabase content schema, local MDX import, published-content build sync, project/article Markdown editors and safe preview, draft/scheduled/published workflow, dashboard metrics, deployment hooks, and scheduled publishing.
- Protected image uploads, optimization, metadata, private previews, explicit publishing, safe deletion, About-page editing, and site metadata editing.

Production sign-in, database, storage, and publishing have not been exercised against a real Supabase/Vercel project in this workspace. They require the environment variables above and applying both migrations.
