-- Keep the mobile Today card, One Focus and Score Detail on one canonical score source.
-- Pillar scoring and week comparisons remain owned by calculate_dad_score_period.

-- Preserve existing 0–4 rows and mark new mobile 1–5 rows explicitly. Legacy
-- clients continue to write the legacy scale through the default version.
alter table public.mood_logs
  add column if not exists mood_scale_version smallint not null default 0;
alter table public.mood_logs drop constraint if exists mood_logs_mood_scale_version_check;
alter table public.mood_logs add constraint mood_logs_mood_scale_version_check
  check (mood_scale_version in (0, 1));

alter table public.mood_logs drop constraint if exists mood_logs_mood_value_check;
alter table public.mood_logs add constraint mood_logs_mood_value_check
  check (
    (mood_scale_version = 0 and mood_value between 0 and 4)
    or (mood_scale_version = 1 and mood_value between 1 and 5)
  );

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
language sql stable security invoker set search_path = public
as $$
  select
    coalesce((
      select avg(
        case
          when m.stress_level is null then
            (m.mood_value - case when m.mood_scale_version = 1 then 1 else 0 end) * 25.0
          else (
            (m.mood_value - case when m.mood_scale_version = 1 then 1 else 0 end) * 25.0
            + ((5 - m.stress_level) * 25.0)
          ) / 2.0
        end
      )
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
      + coalesce((
        select sum(case
          when not exists (select 1 from public.co_parenting_schedules s where s.user_id = p_user_id) then bl.quality * 5
          when bl.created_at::date = any (select unnest(s.custody_dates) from public.co_parenting_schedules s where s.user_id = p_user_id) then bl.quality * 5
          else bl.quality * 2 end)
        from public.bond_logs bl where bl.user_id = p_user_id and bl.created_at >= p_start_time and bl.created_at < p_end_time
      ), 0)
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

revoke all on function public.calculate_dad_score_period(uuid, date, date, timestamptz, timestamptz) from public;
grant execute on function public.calculate_dad_score_period(uuid, date, date, timestamptz, timestamptz) to authenticated, service_role;

create or replace view public.dad_score_view
  with (security_invoker = true)
as
select
  p.user_id,
  current_scores.mind_score,
  current_scores.body_score,
  current_scores.bond_score::bigint as bond_score,
  case when previous_scores.mind_has_data then previous_scores.mind_score end as previous_mind_score,
  case when previous_scores.body_has_data then previous_scores.body_score end as previous_body_score,
  case when previous_scores.bond_has_data then previous_scores.bond_score end as previous_bond_score,
  case when previous_scores.mind_has_data then current_scores.mind_score - previous_scores.mind_score end as mind_week_change,
  case when previous_scores.body_has_data then current_scores.body_score - previous_scores.body_score end as body_week_change,
  case when previous_scores.bond_has_data then current_scores.bond_score - previous_scores.bond_score end as bond_week_change,
  round((current_scores.mind_score + current_scores.body_score + current_scores.bond_score) / 3.0)::integer as total_score,
  case
    when current_scores.mind_score <= current_scores.body_score
      and current_scores.mind_score <= current_scores.bond_score then 'mind'
    when current_scores.body_score <= current_scores.bond_score then 'body'
    else 'bond'
  end as weakest_pillar,
  case
    when not exists (
      select 1 from public.mood_logs m
      where m.user_id = p.user_id and m.date = current_date
    ) then 'checkin'::text
    else (
      select actions.action
      from lateral (values
        -- There is no persisted breathing-completion record yet, so do not
        -- infer that a Mind reset has been completed from other activity.
        (current_scores.mind_score, true,
          'mind_breathing'::text, 1),
        (current_scores.body_score, not exists (
          select 1 from public.workout_sessions w
          where w.user_id = p.user_id
            and w.performed_at >= current_date::timestamptz
            and w.performed_at < (current_date + 1)::timestamptz
        ), 'body_workout'::text, 2),
        (current_scores.bond_score, not exists (
          select 1 from public.journal_entries j
          where j.user_id = p.user_id
            and j.created_at >= current_date::timestamptz
            and j.created_at < (current_date + 1)::timestamptz
        ) and not exists (
          select 1 from public.bond_logs bl
          where bl.user_id = p.user_id
            and bl.created_at >= current_date::timestamptz
            and bl.created_at < (current_date + 1)::timestamptz
        ) and not exists (
          select 1 from public.present_dad_sessions pds
          where pds.user_id = p.user_id and pds.status = 'completed'
            and pds.completed_at >= current_date::timestamptz
            and pds.completed_at < (current_date + 1)::timestamptz
        ), 'bond_present_mode'::text, 3)
      ) as actions(score, available, action, priority)
      where actions.available
      order by actions.score, actions.priority
      limit 1
    )
  end as recommended_action
from public.user_profile p
cross join lateral public.calculate_dad_score_period(
  p.user_id,
  date_trunc('week', current_date)::date,
  date_trunc('week', current_date)::date + 7,
  date_trunc('week', current_date)::date::timestamptz,
  (date_trunc('week', current_date)::date + 7)::timestamptz
) current_scores
cross join lateral public.calculate_dad_score_period(
  p.user_id,
  date_trunc('week', current_date)::date - 7,
  date_trunc('week', current_date)::date,
  (date_trunc('week', current_date)::date - 7)::timestamptz,
  date_trunc('week', current_date)::date::timestamptz
) previous_scores;

grant select on public.dad_score_view to authenticated;

create or replace view public.dad_score_history_view
  with (security_invoker = true)
as
select
  p.user_id,
  weeks.week_start,
  round((scores.mind_score + scores.body_score + scores.bond_score) / 3.0)::integer as total_score,
  scores.mind_score,
  scores.body_score,
  scores.bond_score
from public.user_profile p
cross join generate_series(0, 7) as offsets(week_offset)
cross join lateral (
  select (date_trunc('week', current_date)::date - (week_offset * 7))::date as week_start
) weeks
cross join lateral public.calculate_dad_score_period(
  p.user_id,
  weeks.week_start,
  weeks.week_start + 7,
  weeks.week_start::timestamptz,
  (weeks.week_start + 7)::timestamptz
) scores;

grant select on public.dad_score_history_view to authenticated;
