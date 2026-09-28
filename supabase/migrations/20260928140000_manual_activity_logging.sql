begin;

-- The migration week is the effective week for the manual-score model. Closed
-- weeks before it continue to use their original canonical scoring formula.
create table if not exists public.activity_score_config (
  singleton boolean primary key default true check (singleton),
  effective_week_start date not null check (extract(isodow from effective_week_start) = 1)
);

insert into public.activity_score_config(singleton, effective_week_start)
values (true, date_trunc('week', current_date)::date)
on conflict (singleton) do nothing;

alter table public.activity_score_config enable row level security;
drop policy if exists activity_score_config_read on public.activity_score_config;
create policy activity_score_config_read on public.activity_score_config
  for select to authenticated using (true);
revoke all on public.activity_score_config from public, anon;
grant select on public.activity_score_config to authenticated, service_role;

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_request_id uuid not null,
  pillar text not null check (pillar in ('body', 'bond', 'mind')),
  category text,
  activity_type text not null,
  other_activity_text text,
  duration_minutes integer,
  intensity text,
  contact_day boolean,
  notes text,
  activity_date date not null,
  logged_at timestamptz not null default now(),
  backdated_at date,
  constraint activity_logs_idempotency unique (user_id, client_request_id),
  constraint activity_logs_positive_duration check (duration_minutes is null or duration_minutes > 0),
  constraint activity_logs_pillar_fields check (
    (pillar = 'body'
      and category is null
      and activity_type in ('crossfit', 'running', 'cycling', 'football', 'gym', 'yoga', 'swimming', 'walking', 'hiit', 'rugby', 'tennis', 'martial_arts', 'other')
      and duration_minutes is not null
      and intensity is not null
      and intensity in ('light', 'moderate', 'hard')
      and contact_day is null
      and ((activity_type = 'other' and nullif(btrim(other_activity_text), '') is not null)
        or (activity_type <> 'other' and other_activity_text is null)))
    or
    (pillar = 'bond'
      and category is not null
      and category in ('routine', 'play', 'active', 'out_and_about', 'remote', 'other')
      and activity_type in ('school_run', 'bedtime_routine', 'bath_time', 'homework_help',
        'garden_play', 'board_games', 'lego', 'drawing', 'imaginative_play',
        'bike_ride', 'walk', 'kick_about', 'swimming', 'park', 'mini_partners',
        'day_trip', 'cinema', 'restaurant', 'match_or_game',
        'phone_call', 'facetime', 'voice_note', 'shared_photo', 'other')
      and intensity is null
      and contact_day is not null
      and ((category = 'routine' and activity_type in ('school_run', 'bedtime_routine', 'bath_time', 'homework_help'))
        or (category = 'play' and activity_type in ('garden_play', 'board_games', 'lego', 'drawing', 'imaginative_play'))
        or (category = 'active' and activity_type in ('bike_ride', 'walk', 'kick_about', 'swimming', 'park', 'mini_partners'))
        or (category = 'out_and_about' and activity_type in ('day_trip', 'cinema', 'restaurant', 'match_or_game'))
        or (category = 'remote' and activity_type in ('phone_call', 'facetime', 'voice_note', 'shared_photo'))
        or (category = 'other' and activity_type = 'other'))
      and ((activity_type = 'other' and nullif(btrim(other_activity_text), '') is not null)
        or (activity_type <> 'other' and other_activity_text is null)))
    or
    (pillar = 'mind'
      and category is not null
      and category in ('professional_support', 'mindfulness', 'social_connection', 'nature_recovery', 'other')
      and activity_type in ('therapy', 'counselling', 'cbt_session', 'group_therapy',
        'meditation', 'mindfulness', 'gratitude_practice',
        'met_a_friend', 'called_family', 'honest_conversation',
        'time_outdoors', 'rest_day', 'sleep_catch_up', 'other')
      and duration_minutes is not null
      and intensity is null
      and contact_day is null
      and ((category = 'professional_support' and activity_type in ('therapy', 'counselling', 'cbt_session', 'group_therapy'))
        or (category = 'mindfulness' and activity_type in ('meditation', 'mindfulness', 'gratitude_practice'))
        or (category = 'social_connection' and activity_type in ('met_a_friend', 'called_family', 'honest_conversation'))
        or (category = 'nature_recovery' and activity_type in ('time_outdoors', 'rest_day', 'sleep_catch_up'))
        or (category = 'other' and activity_type = 'other'))
      and ((activity_type = 'other' and nullif(btrim(other_activity_text), '') is not null)
        or (activity_type <> 'other' and other_activity_text is null)))
  )
);

create index if not exists activity_logs_user_pillar_date_idx
  on public.activity_logs(user_id, pillar, activity_date desc, logged_at desc);
create index if not exists activity_logs_user_date_idx
  on public.activity_logs(user_id, activity_date desc);

alter table public.activity_logs enable row level security;
drop policy if exists activity_logs_select_own on public.activity_logs;
drop policy if exists activity_logs_insert_own on public.activity_logs;
create policy activity_logs_select_own on public.activity_logs
  for select to authenticated using (auth.uid() = user_id);
create policy activity_logs_insert_own on public.activity_logs
  for insert to authenticated with check (auth.uid() = user_id);
revoke all on public.activity_logs from public, anon;
revoke update, delete on public.activity_logs from authenticated;
grant select, insert on public.activity_logs to authenticated;
grant all on public.activity_logs to service_role;

create or replace function public.validate_activity_log_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  utc_today date := (now() at time zone 'UTC')::date;
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

revoke all on function public.validate_activity_log_insert() from public, anon, authenticated;
drop trigger if exists activity_logs_validate_insert on public.activity_logs;
create trigger activity_logs_validate_insert
before insert on public.activity_logs
for each row execute function public.validate_activity_log_insert();

-- Preserve the original canonical calculation as the non-manual input component.
create or replace function public.calculate_dad_score_nonmanual_period(
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
          when bl.created_at::date = any (select unnest(s.custody_dates) from public.co_parenting_schedules s where s.user_id = p_user_id) then bl.quality * 5
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

revoke all on function public.calculate_dad_score_nonmanual_period(uuid, date, date, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.calculate_dad_score_nonmanual_period(uuid, date, date, timestamptz, timestamptz) to service_role;

-- This helper is the single implementation of the approved manual point rules.
-- It is service-role-only so Free clients cannot query manual-only score trends.
create or replace function public.calculate_manual_activity_period(
  p_user_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  mind_manual_points numeric,
  body_manual_points numeric,
  bond_manual_points numeric,
  mind_manual_has_data boolean,
  body_manual_has_data boolean,
  bond_manual_has_data boolean
)
language sql stable security definer set search_path = public
as $$
  with activity_rows as (
    select a.* from public.activity_logs a
    where a.user_id = p_user_id and a.activity_date >= p_start_date and a.activity_date < p_end_date
  ),
  candidates as (
    select a.user_id, a.activity_date, 'body'::text as pillar,
      case
        when a.activity_type = 'mini_partners' and a.duration_minutes is not null and a.duration_minutes < 15 then 0
        when a.activity_type = 'mini_partners' then 8
        when a.duration_minutes < 15 then 0
        when a.intensity = 'light' and a.duration_minutes < 30 then 2
        when a.intensity = 'light' then 4
        when a.intensity = 'moderate' and a.duration_minutes < 30 then 4
        when a.intensity = 'moderate' and a.duration_minutes < 60 then 6
        when a.intensity = 'moderate' then 8
        when a.intensity = 'hard' and a.duration_minutes < 30 then 6
        when a.intensity = 'hard' and a.duration_minutes < 60 then 8
        when a.intensity = 'hard' then 10
        else 0
      end::integer as points,
      a.logged_at, a.id
    from activity_rows a
    where a.pillar = 'body' or (a.pillar = 'bond' and a.activity_type = 'mini_partners')
    union all
    select a.user_id, a.activity_date, 'bond'::text as pillar,
      case
        when a.duration_minutes is not null and a.duration_minutes < 15 then 0
        when a.activity_type = 'mini_partners' then 8
        when a.category in ('routine', 'remote') then case when a.duration_minutes >= 45 then 6 else 4 end
        when a.category in ('play', 'active', 'out_and_about') then case when a.duration_minutes >= 45 then 8 else 6 end
        when a.category = 'other' then case when a.duration_minutes >= 45 then 4 else 2 end
        else 0
      end::integer as points,
      a.logged_at, a.id
    from activity_rows a where a.pillar = 'bond'
    union all
    select a.user_id, a.activity_date, 'mind'::text as pillar,
      case
        when a.duration_minutes < 5 then 0
        when a.category = 'professional_support' then 8
        when a.category in ('mindfulness', 'social_connection') then 4
        when a.category in ('nature_recovery', 'other') then 2
        else 0
      end::integer as points,
      a.logged_at, a.id
    from activity_rows a where a.pillar = 'mind'
  ),
  daily_winners as (
    select distinct on (c.user_id, c.pillar, c.activity_date)
      c.user_id, c.pillar, c.activity_date, c.points
    from candidates c
    where c.points > 0
    order by c.user_id, c.pillar, c.activity_date, c.points desc, c.logged_at desc, c.id
  )
  select
    least(70, coalesce(sum(w.points) filter (where w.pillar = 'mind'), 0)),
    least(70, coalesce(sum(w.points) filter (where w.pillar = 'body'), 0)),
    least(70, coalesce(sum(w.points) filter (where w.pillar = 'bond'), 0)),
    exists (select 1 from activity_rows a where a.pillar = 'mind'),
    exists (select 1 from activity_rows a where a.pillar = 'body')
      or exists (select 1 from activity_rows a where a.pillar = 'bond' and a.activity_type = 'mini_partners'),
    exists (select 1 from activity_rows a where a.pillar = 'bond')
  from daily_winners w;
$$;

revoke all on function public.calculate_manual_activity_period(uuid, date, date) from public, anon, authenticated;
grant execute on function public.calculate_manual_activity_period(uuid, date, date) to service_role;

-- Canonical score: keep closed pre-effective weeks byte-for-byte equivalent in
-- meaning; from the effective week forward scale existing inputs to 30 and add
-- up to 70 daily manual points.
create or replace function public.calculate_dad_score_period(
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
  v_effective_week date;
begin
  if auth.role() = 'authenticated' and auth.uid() is distinct from p_user_id then
    raise exception using errcode = '42501', message = 'score_user_mismatch';
  end if;

  select effective_week_start into v_effective_week
  from public.activity_score_config where singleton = true;

  select * into v_nonmanual
  from public.calculate_dad_score_nonmanual_period(p_user_id, p_start_date, p_end_date, p_start_time, p_end_time);

  if p_start_date < v_effective_week then
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

  mind_score := least(100, greatest(0, coalesce(v_nonmanual.mind_score, 0)) * 0.30 + coalesce(v_manual.mind_manual_points, 0));
  body_score := least(100, greatest(0, coalesce(v_nonmanual.body_score, 0)) * 0.30 + coalesce(v_manual.body_manual_points, 0));
  bond_score := least(100, greatest(0, coalesce(v_nonmanual.bond_score, 0)) * 0.30 + coalesce(v_manual.bond_manual_points, 0));
  mind_has_data := v_nonmanual.mind_has_data or v_manual.mind_manual_has_data;
  body_has_data := v_nonmanual.body_has_data or v_manual.body_manual_has_data;
  bond_has_data := v_nonmanual.bond_has_data or v_manual.bond_manual_has_data;
  return next;
end;
$$;

revoke all on function public.calculate_dad_score_period(uuid, date, date, timestamptz, timestamptz) from public, anon;
grant execute on function public.calculate_dad_score_period(uuid, date, date, timestamptz, timestamptz) to authenticated, service_role;

-- The first new-model week is not compared with a previous week calculated on
-- the old model. Later trends compare periods using identical semantics.
create or replace view public.dad_score_view
  with (security_invoker = true)
as
select
  p.user_id,
  current_scores.mind_score,
  current_scores.body_score,
  current_scores.bond_score::bigint as bond_score,
  case when previous_scores.mind_has_data and current_week.week_start > score_config.effective_week_start then previous_scores.mind_score end as previous_mind_score,
  case when previous_scores.body_has_data and current_week.week_start > score_config.effective_week_start then previous_scores.body_score end as previous_body_score,
  case when previous_scores.bond_has_data and current_week.week_start > score_config.effective_week_start then previous_scores.bond_score end as previous_bond_score,
  case when previous_scores.mind_has_data and current_week.week_start > score_config.effective_week_start
    then current_scores.mind_score - previous_scores.mind_score end as mind_week_change,
  case when previous_scores.body_has_data and current_week.week_start > score_config.effective_week_start
    then current_scores.body_score - previous_scores.body_score end as body_week_change,
  case when previous_scores.bond_has_data and current_week.week_start > score_config.effective_week_start
    then current_scores.bond_score - previous_scores.bond_score end as bond_week_change,
  round((current_scores.mind_score + current_scores.body_score + current_scores.bond_score) / 3.0)::integer as total_score,
  case
    when current_scores.mind_score <= current_scores.body_score and current_scores.mind_score <= current_scores.bond_score then 'mind'
    when current_scores.body_score <= current_scores.bond_score then 'body'
    else 'bond'
  end as weakest_pillar,
  case
    when not exists (select 1 from public.mood_logs m where m.user_id = p.user_id and m.date = current_date) then 'checkin'::text
    else (
      select actions.action from lateral (values
        (current_scores.mind_score, true, 'mind_breathing'::text, 1),
        (current_scores.body_score, not exists (
          select 1 from public.workout_sessions w where w.user_id = p.user_id
            and w.performed_at >= current_date::timestamptz and w.performed_at < (current_date + 1)::timestamptz
        ) and not exists (
          select 1 from public.activity_logs a where a.user_id = p.user_id and a.activity_date = current_date
            and (a.pillar = 'body' or (a.pillar = 'bond' and a.activity_type = 'mini_partners'))
        ), 'body_workout'::text, 2),
        (current_scores.bond_score, not exists (
          select 1 from public.journal_entries j where j.user_id = p.user_id
            and j.created_at >= current_date::timestamptz and j.created_at < (current_date + 1)::timestamptz
        ) and not exists (
          select 1 from public.bond_logs bl where bl.user_id = p.user_id
            and bl.created_at >= current_date::timestamptz and bl.created_at < (current_date + 1)::timestamptz
        ) and not exists (
          select 1 from public.present_dad_sessions pds where pds.user_id = p.user_id and pds.status = 'completed'
            and pds.completed_at >= current_date::timestamptz and pds.completed_at < (current_date + 1)::timestamptz
        ) and not exists (
          select 1 from public.activity_logs a where a.user_id = p.user_id and a.pillar = 'bond' and a.activity_date = current_date
        ), 'bond_present_mode'::text, 3)
      ) as actions(score, available, action, priority)
      where actions.available order by actions.score, actions.priority limit 1
    )
  end as recommended_action
from public.user_profile p
cross join (select date_trunc('week', current_date)::date as week_start) current_week
cross join public.activity_score_config score_config
cross join lateral public.calculate_dad_score_period(
  p.user_id, current_week.week_start, current_week.week_start + 7,
  current_week.week_start::timestamptz, (current_week.week_start + 7)::timestamptz
) current_scores
cross join lateral public.calculate_dad_score_period(
  p.user_id, current_week.week_start - 7, current_week.week_start,
  (current_week.week_start - 7)::timestamptz, current_week.week_start::timestamptz
) previous_scores;

grant select on public.dad_score_view to authenticated;

-- Pro-only derived history is served by the existing server entitlement gate;
-- basic activity rows remain owner-readable for every tier.
create or replace view public.dad_manual_activity_history_view
  with (security_invoker = true)
as
select p.user_id, weeks.week_start,
  scores.mind_manual_points, scores.body_manual_points, scores.bond_manual_points
from public.user_profile p
cross join generate_series(0, 7) as offsets(week_offset)
cross join lateral (select (date_trunc('week', current_date)::date - week_offset * 7)::date as week_start) weeks
cross join public.activity_score_config config
cross join lateral public.calculate_manual_activity_period(
  p.user_id, weeks.week_start, weeks.week_start + 7
) scores
where weeks.week_start >= config.effective_week_start;

revoke all on public.dad_manual_activity_history_view from public, anon, authenticated;
grant select on public.dad_manual_activity_history_view to service_role;

commit;
