-- Weekly report: one server round trip instead of three, keeping access-before-read.
--
-- Order inside the function is fixed and is the security contract:
--   1. Evaluate public.user_has_pro_access(owner). If it is not a boolean, return
--      {"access": null} and read nothing else.
--   2. Only then read the owner's current saved snapshot: the requested week, or the
--      latest one already delivered at p_now. A requested week that is not yet
--      delivered is never read.
--   3. Only when that snapshot's own comparison is available, read the owner's prior
--      snapshot for the week named in it (payload.comparison.previousPeriod.weekStart).
-- Read-only. Service role only (the API route passes the owner from verified sign-in).
-- All metadata validation and the Free/Pro projection stay in the API code.
-- Rollback: drop function public.read_weekly_report_rows(uuid, date, timestamptz);
-- (the API falls back to the previous three-call path when the function is absent).

create or replace function public.read_weekly_report_rows(p_user_id uuid, p_week date, p_now timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_access boolean;
  v_current jsonb;
  v_prior jsonb;
  v_prior_week date;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_user_id is null or p_now is null then
    raise exception 'Owner and time are required' using errcode = '22004';
  end if;

  v_access := public.user_has_pro_access(p_user_id);
  if v_access is null then
    -- Unknown access is neither Free nor Pro: no snapshot is read.
    return jsonb_build_object('access', null, 'current', null, 'prior', null);
  end if;

  if p_week is null then
    select jsonb_build_object('user_id', s.user_id, 'reporting_week_start', s.reporting_week_start,
             'delivery_at', s.delivery_at, 'captured_at', s.captured_at, 'payload', s.payload)
      into v_current
      from public.weekly_report_snapshots s
     where s.user_id = p_user_id and s.delivery_at <= p_now
     order by s.reporting_week_start desc
     limit 1;
  else
    select jsonb_build_object('user_id', s.user_id, 'reporting_week_start', s.reporting_week_start,
             'delivery_at', s.delivery_at, 'captured_at', s.captured_at, 'payload', s.payload)
      into v_current
      from public.weekly_report_snapshots s
     where s.user_id = p_user_id and s.reporting_week_start = p_week and s.delivery_at <= p_now;
  end if;

  if v_current is not null
     and v_current #>> '{payload,comparison,state}' = 'available'
     and coalesce(v_current #>> '{payload,comparison,previousPeriod,weekStart}', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      v_prior_week := (v_current #>> '{payload,comparison,previousPeriod,weekStart}')::date;
    exception when others then
      v_prior_week := null; -- An unparseable stored week only disables the comparison.
    end;
    if v_prior_week is not null then
      select jsonb_build_object('user_id', s.user_id, 'reporting_week_start', s.reporting_week_start,
               'delivery_at', s.delivery_at, 'captured_at', s.captured_at, 'payload', s.payload)
        into v_prior
        from public.weekly_report_snapshots s
       where s.user_id = p_user_id and s.reporting_week_start = v_prior_week;
    end if;
  end if;

  return jsonb_build_object('access', v_access, 'current', v_current, 'prior', v_prior);
end;
$$;

revoke all on function public.read_weekly_report_rows(uuid, date, timestamptz) from public, anon, authenticated;
grant execute on function public.read_weekly_report_rows(uuid, date, timestamptz) to service_role;

comment on function public.read_weekly_report_rows(uuid, date, timestamptz) is
  'Service-only weekly report read: access first; current and prior saved snapshots only after access is a boolean. Read-only.';
