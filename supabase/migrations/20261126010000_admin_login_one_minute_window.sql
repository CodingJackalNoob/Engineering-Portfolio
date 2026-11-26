create or replace function public.check_admin_login_rate_limit(
  p_ip_hash text,
  p_account_hash text
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip_lock bigint;
  v_account_lock bigint;
  v_now timestamptz;
  v_ip_count integer;
  v_account_count integer;
  v_retry_at timestamptz;
  v_ip_retry_at timestamptz;
  v_account_retry_at timestamptz;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise insufficient_privilege using message = 'Only the service role may check admin login limits.';
  end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$'
     or p_account_hash is null or p_account_hash !~ '^[0-9a-f]{64}$' then
    raise invalid_parameter_value using message = 'Rate-limit identifiers must be SHA-256 HMACs.';
  end if;

  v_ip_lock := pg_catalog.hashtextextended('admin-login:ip:' || p_ip_hash, 0);
  v_account_lock := pg_catalog.hashtextextended('admin-login:account:' || p_account_hash, 0);
  if v_ip_lock < v_account_lock then
    perform pg_catalog.pg_advisory_xact_lock(v_ip_lock);
    perform pg_catalog.pg_advisory_xact_lock(v_account_lock);
  else
    perform pg_catalog.pg_advisory_xact_lock(v_account_lock);
    perform pg_catalog.pg_advisory_xact_lock(v_ip_lock);
  end if;

  v_now := pg_catalog.clock_timestamp();
  delete from public.admin_login_attempts
  where attempted_at <= v_now - interval '1 minute';

  select count(*)::integer, min(attempted_at)
  into v_ip_count, v_ip_retry_at
  from public.admin_login_attempts
  where bucket = 'ip' and identifier_hash = p_ip_hash;

  select count(*)::integer, min(attempted_at)
  into v_account_count, v_account_retry_at
  from public.admin_login_attempts
  where bucket = 'account' and identifier_hash = p_account_hash;

  if v_ip_count >= 20 or v_account_count >= 5 then
    if v_ip_count >= 20 then
      v_retry_at := v_ip_retry_at + interval '1 minute';
    end if;
    if v_account_count >= 5 then
      v_retry_at := greatest(v_retry_at, v_account_retry_at + interval '1 minute');
    end if;
    return query
      select false, greatest(1, ceil(extract(epoch from (v_retry_at - v_now)))::integer);
    return;
  end if;

  insert into public.admin_login_attempts (bucket, identifier_hash, attempted_at)
  values ('ip', p_ip_hash, v_now), ('account', p_account_hash, v_now);

  return query select true, 0;
end;
$$;

revoke all on function public.check_admin_login_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.check_admin_login_rate_limit(text, text) to service_role;
