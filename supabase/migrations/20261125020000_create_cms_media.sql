create table if not exists public.cms_media (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (bucket in ('cms-media-private', 'portfolio-media')),
  storage_path text not null,
  original_name text not null,
  content_type text not null default 'image/webp',
  size_bytes bigint not null check (size_bytes > 0),
  alt text not null default '',
  caption text not null default '',
  folder text not null default 'uncategorized',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bucket, storage_path)
);

alter table public.cms_media enable row level security;
revoke all on public.cms_media from anon, authenticated;
grant all on public.cms_media to service_role;

create index if not exists cms_media_folder_created_idx
  on public.cms_media (folder, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('cms-media-private', 'cms-media-private', false, 12582912, array['image/webp']),
  ('portfolio-media', 'portfolio-media', true, 12582912, array['image/webp'])
on conflict (id) do update
set file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
