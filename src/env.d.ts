/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_SUPABASE_URL?: string;
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
  readonly ADMIN_EMAIL?: string;
  readonly ADMIN_SESSION_SECRET?: string;
  readonly CMS_CONTENT_SOURCE?: string;
  readonly VERCEL_DEPLOY_HOOK_URL?: string;
  readonly CRON_SECRET?: string;
}
