begin;

-- Forward-only model. Leave the next calendar week for rollout.
create table if not exists public.mind_score_model_config (
  model_version text primary key check (model_version = 'mind_70_30_v2'),
  effective_week_start date not null check (extract(isodow from effective_week_start) = 1),
  activity_target numeric not null default 28 check (activity_target = 28)
);
insert into public.mind_score_model_config values
  ('mind_70_30_v2', (date_trunc('week', now() at time zone 'UTC') + interval '14 days')::date, 28) on conflict (model_version) do nothing;
alter table public.mind_score_model_config enable row level security;
revoke all on public.mind_score_model_config from public, anon, authenticated;
grant select on public.mind_score_model_config to authenticated;
grant all on public.mind_score_model_config to service_role;
drop policy if exists mind_model_read on public.mind_score_model_config;
create policy mind_model_read on public.mind_score_model_config for select to authenticated using (true);

-- No user backfill. Capture the prior zone on the first subsequent profile change.
-- Zone changes activate at next Monday midnight in the requested new zone.
create table if not exists public.scoring_timezone_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  effective_week_start date not null,
  effective_at timestamptz not null,
  timezone text not null,
  primary key (user_id, effective_week_start)
);
alter table public.scoring_timezone_history enable row level security;
revoke all on public.scoring_timezone_history from public, anon, authenticated;
grant select on public.scoring_timezone_history to authenticated;
grant all on public.scoring_timezone_history to service_role;
drop policy if exists scoring_timezone_read on public.scoring_timezone_history;
create policy scoring_timezone_read on public.scoring_timezone_history for select to authenticated using (user_id = auth.uid());

create or replace function public.scoring_timezone_at(p_user_id uuid, p_at timestamptz)
returns text language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(
    (select h.timezone from public.scoring_timezone_history h where h.user_id = p_user_id and h.effective_at <= p_at order by h.effective_at desc limit 1),
    (select z.name from public.user_profile p join pg_timezone_names z on z.name = p.timezone where p.user_id = p_user_id),
    'UTC');
$$;
revoke all on function public.scoring_timezone_at(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.scoring_timezone_at(uuid,timestamptz) to service_role;

create or replace function public.capture_scoring_timezone()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare old_zone text; new_zone text; next_week date;
begin
  new_zone := coalesce(nullif(new.timezone, ''), 'UTC');
  if not exists (select 1 from pg_timezone_names where name = new_zone) then
    raise exception using errcode = '22023', message = 'invalid_scoring_timezone';
  end if;
  if tg_op = 'INSERT' then
    insert into public.scoring_timezone_history values (new.user_id, '-infinity', '-infinity', new_zone) on conflict do nothing;
  elsif new.timezone is distinct from old.timezone then
    select h.timezone into old_zone from public.scoring_timezone_history h where h.user_id=old.user_id and h.effective_at<=now() order by h.effective_at desc limit 1;
    old_zone := coalesce(old_zone,(select name from pg_timezone_names where name=old.timezone),'UTC');
    insert into public.scoring_timezone_history values (old.user_id, '-infinity', '-infinity', old_zone) on conflict do nothing;
    -- Pending westward changes may still be in Sunday despite the old clock
    -- reading Monday. Do not skip the pending scoring week when editing again.
    next_week := date_trunc('week', least((now() at time zone old_zone)::date,
      coalesce((select min(effective_week_start)-1 from public.scoring_timezone_history
        where user_id=old.user_id and effective_at>now()), 'infinity'::date)))::date + 7;
    if next_week::timestamp at time zone new_zone <= now() then next_week := next_week + 7; end if;
    -- Replace only unactivated requests; keep all effective history immutable.
    delete from public.scoring_timezone_history where user_id=old.user_id and effective_at>now();
    insert into public.scoring_timezone_history values (old.user_id, next_week, next_week::timestamp at time zone new_zone, new_zone)
      on conflict (user_id,effective_week_start) do update set timezone=excluded.timezone, effective_at=excluded.effective_at;
  end if;
  return new;
end;
$$;
revoke all on function public.capture_scoring_timezone() from public, anon, authenticated;
drop trigger if exists capture_scoring_timezone on public.user_profile;
create trigger capture_scoring_timezone after insert or update of timezone on public.user_profile
  for each row execute function public.capture_scoring_timezone();

create or replace function public.scoring_week_boundary(p_user_id uuid, p_week date)
returns timestamptz language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(
    (select h.effective_at from public.scoring_timezone_history h where h.user_id=p_user_id and h.effective_week_start=p_week),
    p_week::timestamp at time zone coalesce(
      (select h.timezone from public.scoring_timezone_history h where h.user_id=p_user_id and h.effective_week_start<=p_week order by h.effective_week_start desc limit 1),
      public.scoring_timezone_at(p_user_id, now())));
$$;
revoke all on function public.scoring_week_boundary(uuid,date) from public, anon, authenticated;
grant execute on function public.scoring_week_boundary(uuid,date) to service_role;

-- A westward change can delay Monday beyond midnight in the old zone.
-- Keep that overlap in Sunday until the new Monday boundary actually arrives.
create or replace function public.scoring_date_at(p_user_id uuid,p_at timestamptz)
returns date language sql stable security definer set search_path=pg_catalog,public as $$
  select least((p_at at time zone public.scoring_timezone_at(p_user_id,p_at))::date,
    coalesce((select min(effective_week_start)-1 from public.scoring_timezone_history
      where user_id=p_user_id and effective_at>p_at), 'infinity'::date));
$$;
revoke all on function public.scoring_date_at(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.scoring_date_at(uuid,timestamptz) to service_role;

-- Stable date labels for new journal rows; edits never move their scoring date.
alter table public.journal_entries add column if not exists scoring_date date;
create or replace function public.stamp_journal_scoring_date()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' then
    new.scoring_date := old.scoring_date;
    new.created_at := old.created_at;
  else
    new.scoring_date := public.scoring_date_at(new.user_id,new.created_at);
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_journal_scoring_date() from public, anon, authenticated;
drop trigger if exists stamp_journal_scoring_date on public.journal_entries;
create trigger stamp_journal_scoring_date before insert or update on public.journal_entries for each row execute function public.stamp_journal_scoring_date();

create table if not exists public.mind_reset_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz not null,
  activity_date date not null,
  active_seconds integer not null check (active_seconds between 60 and 300),
  created_at timestamptz not null default now()
);
create index if not exists mind_reset_sessions_user_date on public.mind_reset_sessions(user_id,activity_date);
alter table public.mind_reset_sessions enable row level security;
revoke all on public.mind_reset_sessions from public, anon, authenticated;
grant select on public.mind_reset_sessions to authenticated;
grant all on public.mind_reset_sessions to service_role;
drop policy if exists mind_reset_read on public.mind_reset_sessions;
create policy mind_reset_read on public.mind_reset_sessions for select to authenticated using (user_id=auth.uid());
create or replace function public.complete_mind_reset(p_id uuid,p_completed_at timestamptz,p_active_seconds integer)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if exists(select 1 from public.mind_reset_sessions where id=p_id and user_id=uid) then return; end if;
  if p_id is null
     or p_completed_at is null
     or p_active_seconds is null
     or p_active_seconds not between 60 and 300
     or p_completed_at > now()
     or p_completed_at < now() - interval '8 days' then
    raise exception using errcode='22023',message='invalid_mind_reset';
  end if;
  insert into public.mind_reset_sessions(id,user_id,completed_at,activity_date,active_seconds)
    values(p_id,uid,p_completed_at,public.scoring_date_at(uid,p_completed_at),p_active_seconds) on conflict (id) do nothing;
  if not exists(select 1 from public.mind_reset_sessions where id=p_id and user_id=uid) then
    raise exception using errcode='42501',message='mind_reset_owner_mismatch';
  end if;
end;
$$;
revoke all on function public.complete_mind_reset(uuid,timestamptz,integer) from public,anon;
grant execute on function public.complete_mind_reset(uuid,timestamptz,integer) to authenticated;

create or replace function public.calculate_dad_score_period_pre_phase2(
  p_user_id uuid,
  p_start_date date,
  p_end_date date,
  p_start_time timestamptz,
  p_end_time timestamptz
)
returns table (
  mind_score numeric,
  body_score numeric,
  bond_score numeric,
  mind_has_data boolean,
  body_has_data boolean,
  bond_has_data boolean
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_nonmanual record;
  v_manual record;
  v_checkins record;
  v_change_07_week date;
  v_model_effective_week date;
  v_manual_weight numeric;
  v_mind_checkin_weight numeric;
  v_checkin_weight numeric;
  v_other_weight numeric;
  v_mind_checkin_days integer;
begin
  if auth.role() = 'authenticated' and auth.uid() is distinct from p_user_id then
    raise exception using errcode = '42501', message = 'score_user_mismatch';
  end if;

  select effective_week_start into v_change_07_week
  from public.activity_score_config where singleton = true;
  if v_change_07_week is null then
    raise exception using errcode = '55000', message = 'activity_score_config_missing';
  end if;

  select effective_week_start, manual_weight, mind_checkin_weight, checkin_weight, other_weight
  into v_model_effective_week, v_manual_weight, v_mind_checkin_weight, v_checkin_weight, v_other_weight
  from public.dad_score_model_config where model_version = '60_40_10_30_v1';
  if v_model_effective_week is null then
    raise exception using errcode = '55000', message = 'score_model_config_missing';
  end if;

  select * into v_nonmanual
  from public.calculate_dad_score_nonmanual_period(
    p_user_id, p_start_date, p_end_date, p_start_time, p_end_time
  );

  -- Preserve the original pre-Change-07 model for closed historical weeks.
  if p_start_date < v_change_07_week then
    mind_score := v_nonmanual.mind_score;
    body_score := v_nonmanual.body_score;
    bond_score := v_nonmanual.bond_score;
    mind_has_data := v_nonmanual.mind_has_data;
    body_has_data := v_nonmanual.body_has_data;
    bond_has_data := v_nonmanual.bond_has_data;
    return next;
    return;
  end if;

  select * into v_manual
  from public.calculate_manual_activity_period(p_user_id, p_start_date, p_end_date);

  -- Preserve the existing Change 07 formula for its full historical interval.
  if p_start_date < v_model_effective_week then
    mind_score := least(100, greatest(0, coalesce(v_nonmanual.mind_score, 0)) * 0.30 + coalesce(v_manual.mind_manual_points, 0));
    body_score := least(100, greatest(0, coalesce(v_nonmanual.body_score, 0)) * 0.30 + coalesce(v_manual.body_manual_points, 0));
    bond_score := least(100, greatest(0, coalesce(v_nonmanual.bond_score, 0)) * 0.30 + coalesce(v_manual.bond_manual_points, 0));
    mind_has_data := v_nonmanual.mind_has_data or v_manual.mind_manual_has_data;
    body_has_data := v_nonmanual.body_has_data or v_manual.body_manual_has_data;
    bond_has_data := v_nonmanual.bond_has_data or v_manual.bond_manual_has_data;
    return next;
    return;
  end if;

  -- Mind check-in credit is proportional to distinct days with a Mood response.
  -- Answers, including historical Stress, never alter score credit.
  select count(distinct m.date)::integer into v_mind_checkin_days
  from public.mood_logs m
  where m.user_id = p_user_id and m.date >= p_start_date and m.date < p_end_date
    and m.mood_value is not null;

  -- Body and Bond receive their participation credit when Energy or Connection
  -- is present at least once in the week. Answer values never affect credit.
  select
    exists (
      select 1 from public.mood_logs m
      where m.user_id = p_user_id and m.date >= p_start_date and m.date < p_end_date
        and m.energy_level is not null
    ) as body_completed,
    exists (
      select 1 from public.mood_logs m
      where m.user_id = p_user_id and m.date >= p_start_date and m.date < p_end_date
        and m.connection_level is not null
    ) as bond_completed
  into v_checkins;

  -- Mood and Stress remain recorded for wellbeing guidance and history, but
  -- answer values do not score. Seven daily Mind check-ins earn 40 points.
  mind_score := least(100,
    coalesce(v_manual.mind_manual_points, 0) * v_manual_weight / 70.0
      + least(coalesce(v_mind_checkin_days, 0), 7) * v_mind_checkin_weight / 7.0
  );
  body_score := least(100,
    coalesce(v_manual.body_manual_points, 0) * v_manual_weight / 70.0
      + case when v_checkins.body_completed then v_checkin_weight else 0 end
      + greatest(0, coalesce(v_nonmanual.body_score, 0)) * v_other_weight / 100.0
  );
  bond_score := least(100,
    coalesce(v_manual.bond_manual_points, 0) * v_manual_weight / 70.0
      + case when v_checkins.bond_completed then v_checkin_weight else 0 end
      + greatest(0, coalesce(v_nonmanual.bond_score, 0)) * v_other_weight / 100.0
  );

  mind_has_data := v_manual.mind_manual_has_data or coalesce(v_mind_checkin_days, 0) > 0;
  body_has_data := v_manual.body_manual_has_data or v_checkins.body_completed or v_nonmanual.body_has_data;
  bond_has_data := v_manual.bond_manual_has_data or v_checkins.bond_completed or v_nonmanual.bond_has_data;
  return next;
end;
$$;

revoke all on function public.calculate_dad_score_period_pre_phase2(uuid, date, date, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.calculate_dad_score_period_pre_phase2(uuid, date, date, timestamptz, timestamptz) to service_role;


-- Helpers used by security-invoker views must be callable only for the owner.
create or replace function public.scoring_current_date(p_user_id uuid)
returns date language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare account_day date; effective_day date;
begin
  if auth.role() <> 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception using errcode='42501',message='score_user_mismatch';
  end if;
  account_day := public.scoring_date_at(p_user_id,now());
  select effective_week_start into strict effective_day from public.mind_score_model_config where model_version='mind_70_30_v2';
  if account_day >= effective_day then
    return account_day;
  end if;
  -- Do not let the database Monday activate a western account on its Sunday.
  return least(current_date, effective_day - 1);
end;
$$;
revoke all on function public.scoring_current_date(uuid) from public,anon;
grant execute on function public.scoring_current_date(uuid) to authenticated,service_role;

create or replace function public.get_scoring_calendar()
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare uid uuid := auth.uid(); zone text;
begin
  if uid is null then raise exception using errcode='42501',message='authentication_required'; end if;
  -- Send the baseline plus all dated changes, so reloading after travel does
  -- not reinterpret earlier events using the newest timezone.
  select timezone into zone from public.scoring_timezone_history where user_id=uid order by effective_at limit 1;
  zone := coalesce(zone,public.scoring_timezone_at(uid,now()));
  return jsonb_build_object('timezone',zone,'effectiveWeekStart',
    (select effective_week_start from public.mind_score_model_config where model_version='mind_70_30_v2'),
    'changes', coalesce((select jsonb_agg(jsonb_build_object('at',effective_at,'timezone',timezone,'weekStart',effective_week_start) order by effective_at)
      from public.scoring_timezone_history where user_id=uid and isfinite(effective_at)),'[]'::jsonb));
end;
$$;
revoke all on function public.get_scoring_calendar() from public,anon;
grant execute on function public.get_scoring_calendar() to authenticated;

-- Owner-scoped boundary for display/recommendation queries. Historical callers
-- retain their database-timezone dates; only the new model uses account time.
create or replace function public.scoring_display_boundary(p_user_id uuid,p_day date)
returns timestamptz language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if auth.role()='authenticated' and auth.uid() is distinct from p_user_id then
    raise exception using errcode='42501',message='score_user_mismatch';
  end if;
  if p_day < (select effective_week_start from public.mind_score_model_config where model_version='mind_70_30_v2') then
    return p_day::timestamptz;
  end if;
  return public.scoring_week_boundary(p_user_id,p_day);
end;
$$;
revoke all on function public.scoring_display_boundary(uuid,date) from public,anon;
grant execute on function public.scoring_display_boundary(uuid,date) to authenticated,service_role;

create or replace function public.calculate_mind_activity_points_v2(p_user_id uuid,p_start date,p_end date)
returns numeric language sql stable security definer set search_path = pg_catalog, public as $$
  with candidates as (
    select activity_date, case when duration_minutes < 5 then 0
      when category='professional_support' then 8
      when category in ('mindfulness','social_connection') then 4
      when category in ('nature_recovery','other') then 2 else 0 end as points
    from public.activity_logs where user_id=p_user_id and pillar='mind' and activity_date>=p_start and activity_date<p_end
    union all
    select activity_date,4 from public.mind_reset_sessions where user_id=p_user_id and activity_date>=p_start and activity_date<p_end
    union all
    select coalesce(scoring_date,(created_at at time zone public.scoring_timezone_at(user_id,created_at))::date),4
    from public.journal_entries where user_id=p_user_id
  ), daily as (
    select activity_date,max(points) as points from candidates where activity_date>=p_start and activity_date<p_end group by activity_date
  ) select coalesce(sum(points),0) from daily;
$$;
revoke all on function public.calculate_mind_activity_points_v2(uuid,date,date) from public,anon,authenticated;
grant execute on function public.calculate_mind_activity_points_v2(uuid,date,date) to service_role;

create or replace function public.calculate_dad_score_nonmanual_period_v2(
  p_user_id uuid,
  p_start_date date,
  p_end_date date,
  p_start_time timestamptz,
  p_end_time timestamptz
)
returns table (
  mind_score numeric,
  body_score numeric,
  bond_score numeric,
  mind_has_data boolean,
  body_has_data boolean,
  bond_has_data boolean
)
language sql stable security definer set search_path = public
as $$
  select
    coalesce((
      select avg(case
        when m.stress_level is null then
          (m.mood_value - case when m.mood_scale_version = 1 then 1 else 0 end) * 25.0
        else ((m.mood_value - case when m.mood_scale_version = 1 then 1 else 0 end) * 25.0
          + ((5 - m.stress_level) * 25.0)) / 2.0
      end)
      from public.mood_logs m
      where m.user_id = p_user_id and m.date >= p_start_date and m.date < p_end_date
    ), 0) as mind_score,
    least(
      coalesce((select count(*) * 8 from public.workout_sessions w
        where w.user_id = p_user_id and w.performed_at >= p_start_time and w.performed_at < p_end_time), 0)
      + coalesce((select least(avg(s.hours) / 8 * 30, 30) from public.sleep_logs s
        where s.user_id = p_user_id and s.date >= p_start_date and s.date < p_end_date), 0)
      + coalesce((select least(avg(bm.value) / 10000 * 20, 20) from public.body_metrics bm
        where bm.user_id = p_user_id and bm.metric_type = 'steps' and bm.recorded_at >= p_start_time and bm.recorded_at < p_end_time), 0)
      + coalesce((select least(avg(bm.value) / 30 * 10, 10) from public.body_metrics bm
        where bm.user_id = p_user_id and bm.metric_type = 'active_mins' and bm.recorded_at >= p_start_time and bm.recorded_at < p_end_time), 0),
      100
    ) as body_score,
    least(
      coalesce((select count(*) * 15 from public.journal_entries j
        where j.user_id = p_user_id and j.created_at >= p_start_time and j.created_at < p_end_time), 0)
      + coalesce((select sum(case
          when not exists (select 1 from public.co_parenting_schedules s where s.user_id = p_user_id) then bl.quality * 5
          when (bl.created_at at time zone public.scoring_timezone_at(bl.user_id,bl.created_at))::date = any (select unnest(s.custody_dates) from public.co_parenting_schedules s where s.user_id = p_user_id) then bl.quality * 5
          else bl.quality * 2 end)
        from public.bond_logs bl where bl.user_id = p_user_id and bl.created_at >= p_start_time and bl.created_at < p_end_time), 0)
      + coalesce((select count(*) * 15 from public.present_dad_sessions pds
        where pds.user_id = p_user_id and pds.status = 'completed' and pds.completed_at >= p_start_time and pds.completed_at < p_end_time), 0),
      100
    ) as bond_score,
    exists (select 1 from public.mood_logs m where m.user_id = p_user_id and m.date >= p_start_date and m.date < p_end_date),
    exists (select 1 from public.workout_sessions w where w.user_id = p_user_id and w.performed_at >= p_start_time and w.performed_at < p_end_time)
      or exists (select 1 from public.sleep_logs s where s.user_id = p_user_id and s.date >= p_start_date and s.date < p_end_date)
      or exists (select 1 from public.body_metrics bm where bm.user_id = p_user_id and bm.metric_type in ('steps', 'active_mins') and bm.recorded_at >= p_start_time and bm.recorded_at < p_end_time),
    exists (select 1 from public.journal_entries j where j.user_id = p_user_id and j.created_at >= p_start_time and j.created_at < p_end_time)
      or exists (select 1 from public.bond_logs bl where bl.user_id = p_user_id and bl.created_at >= p_start_time and bl.created_at < p_end_time)
      or exists (select 1 from public.present_dad_sessions pds where pds.user_id = p_user_id and pds.status = 'completed' and pds.completed_at >= p_start_time and pds.completed_at < p_end_time);
$$;

revoke all on function public.calculate_dad_score_nonmanual_period_v2(uuid, date, date, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.calculate_dad_score_nonmanual_period_v2(uuid, date, date, timestamptz, timestamptz) to service_role;

create or replace function public.calculate_dad_score_period(
 p_user_id uuid,p_start_date date,p_end_date date,p_start_time timestamptz,p_end_time timestamptz
) returns table(mind_score numeric,body_score numeric,bond_score numeric,mind_has_data boolean,body_has_data boolean,bond_has_data boolean)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare config record; prior record; manual record; weights record; days integer; activity numeric; start_at timestamptz; end_at timestamptz;
begin
  if auth.role()='authenticated' and auth.uid() is distinct from p_user_id then
    raise exception using errcode='42501',message='score_user_mismatch';
  end if;
  select * into strict config from public.mind_score_model_config where model_version='mind_70_30_v2';
  if p_start_date < config.effective_week_start then
    return query select * from public.calculate_dad_score_period_pre_phase2(p_user_id,p_start_date,p_end_date,p_start_time,p_end_time);
    return;
  end if;
  start_at := public.scoring_week_boundary(p_user_id,p_start_date);
  end_at := public.scoring_week_boundary(p_user_id,p_end_date);
  select * into prior from public.calculate_dad_score_nonmanual_period_v2(p_user_id,p_start_date,p_end_date,start_at,end_at);
  select * into manual from public.calculate_manual_activity_period(p_user_id,p_start_date,p_end_date);
  select * into weights from public.dad_score_model_config where model_version='60_40_10_30_v1';
  select count(distinct date) into days from public.mood_logs where user_id=p_user_id and date>=p_start_date and date<p_end_date and mood_value is not null;
  activity := public.calculate_mind_activity_points_v2(p_user_id,p_start_date,p_end_date);
  mind_score := least(days,7)*10 + least(activity/config.activity_target,1)*30;
  mind_has_data := days>0 or activity>0;
  body_has_data := exists(select 1 from public.mood_logs where user_id=p_user_id and date>=p_start_date and date<p_end_date and energy_level is not null);
  bond_has_data := exists(select 1 from public.mood_logs where user_id=p_user_id and date>=p_start_date and date<p_end_date and connection_level is not null);
  body_score := least(100, coalesce(manual.body_manual_points,0)*weights.manual_weight/70.0 + case when body_has_data then weights.checkin_weight else 0 end + greatest(0,coalesce(prior.body_score,0))*weights.other_weight/100.0);
  bond_score := least(100, coalesce(manual.bond_manual_points,0)*weights.manual_weight/70.0 + case when bond_has_data then weights.checkin_weight else 0 end + greatest(0,coalesce(prior.bond_score,0))*weights.other_weight/100.0);
  body_has_data := body_has_data or manual.body_manual_has_data or prior.body_has_data;
  bond_has_data := bond_has_data or manual.bond_manual_has_data or prior.bond_has_data;
  return next;
end;
$$;
revoke all on function public.calculate_dad_score_period(uuid,date,date,timestamptz,timestamptz) from public,anon;
grant execute on function public.calculate_dad_score_period(uuid,date,date,timestamptz,timestamptz) to authenticated,service_role;

create or replace view public.dad_score_view
  with (security_invoker = true)
as
select
  p.user_id,
  current_scores.mind_score,
  current_scores.body_score,
  current_scores.bond_score::bigint as bond_score,
  case when previous_scores.mind_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start, case when current_week.week_start >= mind_model.effective_week_start then mind_model.effective_week_start else model_config.effective_week_start end) then previous_scores.mind_score end as previous_mind_score,
  case when previous_scores.body_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start, case when current_week.week_start >= mind_model.effective_week_start then mind_model.effective_week_start else model_config.effective_week_start end) then previous_scores.body_score end as previous_body_score,
  case when previous_scores.bond_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start, case when current_week.week_start >= mind_model.effective_week_start then mind_model.effective_week_start else model_config.effective_week_start end) then previous_scores.bond_score end as previous_bond_score,
  case when previous_scores.mind_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start, case when current_week.week_start >= mind_model.effective_week_start then mind_model.effective_week_start else model_config.effective_week_start end)
    then current_scores.mind_score - previous_scores.mind_score end as mind_week_change,
  case when previous_scores.body_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start, case when current_week.week_start >= mind_model.effective_week_start then mind_model.effective_week_start else model_config.effective_week_start end)
    then current_scores.body_score - previous_scores.body_score end as body_week_change,
  case when previous_scores.bond_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start, case when current_week.week_start >= mind_model.effective_week_start then mind_model.effective_week_start else model_config.effective_week_start end)
    then current_scores.bond_score - previous_scores.bond_score end as bond_week_change,
  round((current_scores.mind_score + current_scores.body_score + current_scores.bond_score) / 3.0)::integer as total_score,
  case
    when current_scores.mind_score <= current_scores.body_score and current_scores.mind_score <= current_scores.bond_score then 'mind'
    when current_scores.body_score <= current_scores.bond_score then 'body'
    else 'bond'
  end as weakest_pillar,
  case
    when not exists (select 1 from public.mood_logs m where m.user_id = p.user_id and m.date = current_week.today) then 'checkin'::text
    else (
      select actions.action from lateral (values
        (current_scores.mind_score, true, 'mind_breathing'::text, 1),
        (current_scores.body_score, not exists (
          select 1 from public.workout_sessions w where w.user_id = p.user_id
            and w.performed_at >= public.scoring_display_boundary(p.user_id,current_week.today) and w.performed_at < public.scoring_display_boundary(p.user_id,current_week.today + 1)
        ) and not exists (
          select 1 from public.activity_logs a where a.user_id = p.user_id and a.activity_date = current_week.today
            and (a.pillar = 'body' or (a.pillar = 'bond' and a.activity_type = 'mini_partners'))
        ), 'body_workout'::text, 2),
        (current_scores.bond_score, not exists (
          select 1 from public.journal_entries j where j.user_id = p.user_id
            and j.created_at >= public.scoring_display_boundary(p.user_id,current_week.today) and j.created_at < public.scoring_display_boundary(p.user_id,current_week.today + 1)
        ) and not exists (
          select 1 from public.bond_logs bl where bl.user_id = p.user_id
            and bl.created_at >= public.scoring_display_boundary(p.user_id,current_week.today) and bl.created_at < public.scoring_display_boundary(p.user_id,current_week.today + 1)
        ) and not exists (
          select 1 from public.present_dad_sessions pds where pds.user_id = p.user_id and pds.status = 'completed'
            and pds.completed_at >= public.scoring_display_boundary(p.user_id,current_week.today) and pds.completed_at < public.scoring_display_boundary(p.user_id,current_week.today + 1)
        ) and not exists (
          select 1 from public.activity_logs a where a.user_id = p.user_id and a.pillar = 'bond' and a.activity_date = current_week.today
        ), 'bond_present_mode'::text, 3)
      ) as actions(score, available, action, priority)
      where actions.available order by actions.score, actions.priority limit 1
    )
  end as recommended_action,
  public.is_dad_score_baseline_available(
    p.created_at, score_config.effective_week_start, current_week.week_start
  ) as baseline_available
from public.user_profile p
cross join lateral (select public.scoring_current_date(p.user_id) as today, date_trunc('week',public.scoring_current_date(p.user_id))::date as week_start) current_week
cross join public.mind_score_model_config mind_model
cross join public.activity_score_config score_config
cross join (
  select * from public.dad_score_model_config where model_version = '60_40_10_30_v1'
) model_config
cross join lateral public.calculate_dad_score_period(
  p.user_id, current_week.week_start, current_week.week_start + 7,
  current_week.week_start::timestamptz, (current_week.week_start + 7)::timestamptz
) current_scores
cross join lateral public.calculate_dad_score_period(
  p.user_id, current_week.week_start - 7, current_week.week_start,
  (current_week.week_start - 7)::timestamptz, current_week.week_start::timestamptz
) previous_scores;

grant select on public.dad_score_view to authenticated;

-- Keep raw history, but label each period's formula so the Pro API can avoid
-- comparing bars calculated under different models.
create or replace view public.dad_score_history_view
  with (security_invoker = true)
as
select
  p.user_id,
  weeks.week_start,
  round((scores.mind_score + scores.body_score + scores.bond_score) / 3.0)::integer as total_score,
  scores.mind_score,
  scores.body_score,
  scores.bond_score,
  scores.mind_has_data,
  scores.body_has_data,
  scores.bond_has_data,
  case
    when weeks.week_start < activity_config.effective_week_start then 'legacy'
    when weeks.week_start < model_config.effective_week_start then 'change_07_70_30'
    when weeks.week_start < mind_model.effective_week_start then model_config.model_version
    else mind_model.model_version
  end as score_model_version
from public.user_profile p
cross join generate_series(0, 7) as offsets(week_offset)
cross join lateral (
  select (date_trunc('week', public.scoring_current_date(p.user_id))::date - (week_offset * 7))::date as week_start
) weeks
cross join public.activity_score_config activity_config
cross join public.mind_score_model_config mind_model
cross join (
  select * from public.dad_score_model_config where model_version = '60_40_10_30_v1'
) model_config
cross join lateral public.calculate_dad_score_period(
  p.user_id, weeks.week_start, weeks.week_start + 7,
  weeks.week_start::timestamptz, (weeks.week_start + 7)::timestamptz
) scores;

revoke all on public.dad_score_history_view from anon, authenticated;
grant select on public.dad_score_history_view to service_role;

-- Align the displayed history window, retaining every stored activity date and
-- the existing raw manual-points calculation and response columns.
create or replace view public.dad_manual_activity_history_view
  with (security_invoker = true)
as
select p.user_id, weeks.week_start,
  scores.mind_manual_points, scores.body_manual_points, scores.bond_manual_points
from public.user_profile p
cross join generate_series(0, 7) as offsets(week_offset)
cross join lateral (select (date_trunc('week', public.scoring_current_date(p.user_id))::date - week_offset * 7)::date as week_start) weeks
cross join public.activity_score_config config
cross join lateral public.calculate_manual_activity_period(
  p.user_id, weeks.week_start, weeks.week_start + 7
) scores
where weeks.week_start >= config.effective_week_start;
revoke all on public.dad_manual_activity_history_view from public, anon, authenticated;
grant select on public.dad_manual_activity_history_view to service_role;

create or replace function public.validate_activity_log_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  utc_today date := case when public.scoring_current_date(new.user_id) >= (select effective_week_start from public.mind_score_model_config where model_version='mind_70_30_v2') then public.scoring_current_date(new.user_id) else (now() at time zone 'UTC')::date end;
begin
  if auth.uid() is not null and new.user_id <> auth.uid() then
    raise exception using errcode = '42501', message = 'activity_log_user_mismatch';
  end if;
  if exists (select 1 from public.activity_logs a
    where a.user_id = new.user_id and a.client_request_id = new.client_request_id) then
    new.logged_at := now();
    return new;
  end if;
  if new.activity_date > utc_today then
    raise exception using errcode = '22023', message = 'activity_date_cannot_be_future';
  end if;
  if new.activity_date < utc_today - 7 then
    raise exception using errcode = '22023', message = 'activity_date_exceeds_backdate_limit';
  end if;

  -- These are server-recorded audit fields; callers cannot spoof them.
  new.logged_at := now();
  new.backdated_at := case when new.activity_date < utc_today then new.activity_date else null end;
  return new;
end;
$$;


commit;
