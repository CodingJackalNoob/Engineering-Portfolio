create table if not exists public.cms_content (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('project', 'article')),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  data jsonb not null,
  body text not null default '',
  publication_state text not null default 'draft' check (publication_state in ('draft', 'scheduled', 'published')),
  scheduled_at timestamptz,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_type, slug),
  check ((publication_state = 'scheduled') = (scheduled_at is not null))
);

create table if not exists public.cms_activity (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  content_type text,
  content_slug text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.cms_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.cms_content enable row level security;
alter table public.cms_activity enable row level security;
alter table public.cms_settings enable row level security;

revoke all on public.cms_content, public.cms_activity, public.cms_settings from anon, authenticated;
grant all on public.cms_content, public.cms_activity, public.cms_settings to service_role;
grant usage, select on sequence public.cms_activity_id_seq to service_role;

create index if not exists cms_content_state_type_updated_idx
  on public.cms_content (publication_state, content_type, updated_at desc);
create index if not exists cms_content_schedule_idx
  on public.cms_content (scheduled_at)
  where publication_state = 'scheduled';
create index if not exists cms_activity_created_at_idx
  on public.cms_activity (created_at desc);
