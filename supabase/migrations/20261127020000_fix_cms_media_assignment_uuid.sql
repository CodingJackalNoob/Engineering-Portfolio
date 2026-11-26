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

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item(value)
    where jsonb_typeof(item.value -> 'mediaId') is distinct from 'string'
  ) then
    raise invalid_parameter_value using message = 'Each media assignment must include mediaId as a UUID string.';
  end if;

  begin
    perform (item.value ->> 'mediaId')::uuid
    from jsonb_array_elements(p_items) as item(value);
  exception
    when invalid_text_representation then
      raise invalid_parameter_value using message = 'Each media assignment mediaId must be a valid UUID.';
  end;

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
    (item.value ->> 'mediaId')::uuid,
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
