
-- Dad Health: Privacy request rate limiting
-- Isolated to the privacy-request API.
-- Limit enforced by API: 5 requests per IP per 600 seconds.

begin;

-- 1. Rate-limit counters
create table public.privacy_request_rate_limits (
  bucket_hash text primary key
    check (bucket_hash ~ '^[0-9a-f]{64}$'),

  window_started_at timestamptz not null default now(),

  request_count integer not null default 0
    check (request_count >= 0),

  updated_at timestamptz not null default now()
);

alter table public.privacy_request_rate_limits
  owner to postgres;

alter table public.privacy_request_rate_limits
  enable row level security;

revoke all on table public.privacy_request_rate_limits
  from public, anon, authenticated, service_role;

create index privacy_request_rate_limits_updated_idx
  on public.privacy_request_rate_limits (updated_at);


-- 2. Atomic rate-limit function
create function public.consume_privacy_request_rate_limit(
  p_bucket_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window timestamptz;
  v_count integer;
begin
  -- Only server-side service-role requests may execute.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required'
      using errcode = '42501';
  end if;

  -- Reject invalid configuration.
  if p_bucket_hash is null
     or p_bucket_hash !~ '^[0-9a-f]{64}$'
     or p_limit is null
     or p_limit < 1
     or p_limit > 100
     or p_window_seconds is null
     or p_window_seconds < 60
     or p_window_seconds > 86400 then

    raise exception 'Invalid rate-limit configuration';
  end if;

  -- Atomic fixed-window counter.
  insert into public.privacy_request_rate_limits (
    bucket_hash,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    p_bucket_hash,
    v_now,
    1,
    v_now
  )
  on conflict (bucket_hash) do update set

    window_started_at = case
      when privacy_request_rate_limits.window_started_at
        <= v_now - make_interval(secs => p_window_seconds)
      then v_now
      else privacy_request_rate_limits.window_started_at
    end,

    request_count = case
      when privacy_request_rate_limits.window_started_at
        <= v_now - make_interval(secs => p_window_seconds)
      then 1
      else least(
        privacy_request_rate_limits.request_count + 1,
        p_limit + 1
      )
    end,

    updated_at = v_now

  returning window_started_at, request_count
    into v_window, v_count;

  return query
  select
    v_count <= p_limit,

    case
      when v_count <= p_limit then 0
      else greatest(
        1,
        ceil(
          extract(epoch from (
            v_window
            + make_interval(secs => p_window_seconds)
            - v_now
          ))
        )::integer
      )
    end;
end;
$$;

alter function public.consume_privacy_request_rate_limit(
  text, integer, integer
) owner to postgres;

revoke all on function
  public.consume_privacy_request_rate_limit(
    text, integer, integer
  )
  from public, anon, authenticated, service_role;

grant execute on function
  public.consume_privacy_request_rate_limit(
    text, integer, integer
  )
  to service_role;


-- 3. Verify pg_cron is available before scheduling.
do $check_cron$
begin
  if not exists (
    select 1
    from pg_extension
    where extname = 'pg_cron'
  ) then
    raise exception
      'pg_cron is not enabled. Enable it before running this migration.';
  end if;
end;
$check_cron$;


-- 4. Schedule bounded cleanup.
do $cleanup_schedule$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'privacy-request-rate-limit-cleanup'
  ) then
    perform cron.unschedule(
      'privacy-request-rate-limit-cleanup'
    );
  end if;

  perform cron.schedule(
    'privacy-request-rate-limit-cleanup',
    '7 * * * *',
    $cleanup_job$

      with stale as (
        select bucket_hash
        from public.privacy_request_rate_limits
        where updated_at < now() - interval '24 hours'
        order by updated_at
        limit 1000
        for update skip locked
      )

      delete from public.privacy_request_rate_limits
        as rate_limits
      using stale
      where rate_limits.bucket_hash = stale.bucket_hash;

    $cleanup_job$
  );
end;
$cleanup_schedule$;

commit;