alter table public.cms_media
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists variants jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.cms_media
  add constraint cms_media_dimensions_positive
    check ((width is null or width > 0) and (height is null or height > 0));

create table if not exists public.cms_media_assignments (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type ~ '^[a-z][a-z0-9_-]{0,39}$'),
  owner_id text not null check (length(owner_id) between 1 and 200),
  field_key text not null check (field_key ~ '^[a-z][a-z0-9._-]{0,119}$'),
  media_id uuid not null references public.cms_media(id) on delete restrict,
  position integer not null default 0 check (position >= 0),
  alt text not null default '',
  caption text not null default '',
  focal_x numeric(4,3) not null default 0.500 check (focal_x between 0 and 1),
  focal_y numeric(4,3) not null default 0.500 check (focal_y between 0 and 1),
  display_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_type, owner_id, field_key, position)
);

alter table public.cms_media_assignments enable row level security;
revoke all on public.cms_media_assignments from public, anon, authenticated;
grant all on public.cms_media_assignments to service_role;

create index if not exists cms_media_assignments_media_idx
  on public.cms_media_assignments (media_id);
create index if not exists cms_media_assignments_owner_field_idx
  on public.cms_media_assignments (owner_type, owner_id, field_key, position);

create or replace function public.replace_cms_media_assignments(
  p_owner_type text,
  p_owner_id text,
  p_field_key text,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise insufficient_privilege using message = 'Only the service role may update media assignments.';
  end if;
  if p_owner_type is null or p_owner_type !~ '^[a-z][a-z0-9_-]{0,39}$'
     or p_owner_id is null or length(p_owner_id) not between 1 and 200
     or p_field_key is null or p_field_key !~ '^[a-z][a-z0-9._-]{0,119}$'
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) > 80 then
    raise invalid_parameter_value using message = 'The media assignment group is invalid.';
  end if;

  delete from public.cms_media_assignments
  where owner_type = p_owner_type and owner_id = p_owner_id and field_key = p_field_key;

  insert into public.cms_media_assignments (
    owner_type, owner_id, field_key, media_id, position, alt, caption,
    focal_x, focal_y, display_settings
  )
  select
    p_owner_type,
    p_owner_id,
    p_field_key,
    item.value ->> 'mediaId',
    (item.ordinality - 1)::integer,
    coalesce(item.value ->> 'alt', ''),
    coalesce(item.value ->> 'caption', ''),
    coalesce((item.value ->> 'focalX')::numeric, 0.500),
    coalesce((item.value ->> 'focalY')::numeric, 0.500),
    coalesce(item.value -> 'displaySettings', '{}'::jsonb)
  from jsonb_array_elements(p_items) with ordinality as item(value, ordinality);
end;
$$;

revoke all on function public.replace_cms_media_assignments(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_cms_media_assignments(text, text, text, jsonb) to service_role;
