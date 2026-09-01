-- Today score model: daily stress, rolling seven-day trends, and Present Dad Bond credit.

alter table public.mood_logs
add column if not exists stress_level smallint;

alter table public.mood_logs
drop constraint if exists mood_logs_stress_level_chk;

alter table public.mood_logs
add constraint mood_logs_stress_level_chk
check (stress_level between 1 and 5);

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
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce((
      select avg(
        case
          when m.stress_level is null then m.mood_value * 25.0
          else ((m.mood_value * 25.0) + ((5 - m.stress_level) * 25.0)) / 2.0
        end
      )
      from public.mood_logs m
      where m.user_id = p_user_id
        and m.date >= p_start_date
        and m.date < p_end_date
    ), 0) as mind_score,

    least(
      coalesce((
        select count(*) * 8
        from public.workout_sessions w
        where w.user_id = p_user_id
          and w.performed_at >= p_start_time
          and w.performed_at < p_end_time
      ), 0)
      +
      coalesce((
        select least(avg(s.hours) / 8 * 30, 30)
        from public.sleep_logs s
        where s.user_id = p_user_id
          and s.date >= p_start_date
          and s.date < p_end_date
      ), 0)
      +
      coalesce((
        select least(avg(bm.value) / 10000 * 20, 20)
        from public.body_metrics bm
        where bm.user_id = p_user_id
          and bm.metric_type = 'steps'
          and bm.recorded_at >= p_start_time
          and bm.recorded_at < p_end_time
      ), 0)
      +
      coalesce((
        select least(avg(bm.value) / 30 * 10, 10)
        from public.body_metrics bm
        where bm.user_id = p_user_id
          and bm.metric_type = 'active_mins'
          and bm.recorded_at >= p_start_time
          and bm.recorded_at < p_end_time
      ), 0),
      100
    ) as body_score,

    least(
      coalesce((
        select count(*) * 15
        from public.journal_entries j
        where j.user_id = p_user_id
          and j.created_at >= p_start_time
          and j.created_at < p_end_time
      ), 0)
      +
      coalesce((
        select sum(
          case
            when not exists (
              select 1
              from public.co_parenting_schedules s
              where s.user_id = p_user_id
            ) then bl.quality * 5
            when bl.created_at::date = any (
              select unnest(s.custody_dates)
              from public.co_parenting_schedules s
              where s.user_id = p_user_id
            ) then bl.quality * 5
            else bl.quality * 2
          end
        )
        from public.bond_logs bl
        where bl.user_id = p_user_id
          and bl.created_at >= p_start_time
          and bl.created_at < p_end_time
      ), 0)
      +
      coalesce((
        select count(*) * 15
        from public.present_dad_sessions pds
        where pds.user_id = p_user_id
          and pds.status = 'completed'
          and pds.completed_at >= p_start_time
          and pds.completed_at < p_end_time
      ), 0),
      100
    ) as bond_score,

    exists (
      select 1
      from public.mood_logs m
      where m.user_id = p_user_id
        and m.date >= p_start_date
        and m.date < p_end_date
    ) as mind_has_data,

    exists (
      select 1
      from public.workout_sessions w
      where w.user_id = p_user_id
        and w.performed_at >= p_start_time
        and w.performed_at < p_end_time
    ) or exists (
      select 1
      from public.sleep_logs s
      where s.user_id = p_user_id
        and s.date >= p_start_date
        and s.date < p_end_date
    ) or exists (
      select 1
      from public.body_metrics bm
      where bm.user_id = p_user_id
        and bm.metric_type in ('steps', 'active_mins')
        and bm.recorded_at >= p_start_time
        and bm.recorded_at < p_end_time
    ) as body_has_data,

    exists (
      select 1
      from public.journal_entries j
      where j.user_id = p_user_id
        and j.created_at >= p_start_time
        and j.created_at < p_end_time
    ) or exists (
      select 1
      from public.bond_logs bl
      where bl.user_id = p_user_id
        and bl.created_at >= p_start_time
        and bl.created_at < p_end_time
    ) or exists (
      select 1
      from public.present_dad_sessions pds
      where pds.user_id = p_user_id
        and pds.status = 'completed'
        and pds.completed_at >= p_start_time
        and pds.completed_at < p_end_time
    ) as bond_has_data;
$$;

revoke all on function public.calculate_dad_score_period(uuid, date, date, timestamptz, timestamptz) from public;
grant execute on function public.calculate_dad_score_period(uuid, date, date, timestamptz, timestamptz) to authenticated, service_role;

-- This intentionally replaces the old inclusive `current_date - 7` Mind window,
-- which could span eight calendar dates. The current and previous windows are
-- exact, adjacent, non-overlapping seven-day periods.
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
  case when previous_scores.bond_has_data then current_scores.bond_score - previous_scores.bond_score end as bond_week_change
from public.user_profile p
cross join lateral public.calculate_dad_score_period(
  p.user_id,
  current_date - 6,
  current_date + 1,
  now() - interval '7 days',
  now()
) current_scores
cross join lateral public.calculate_dad_score_period(
  p.user_id,
  current_date - 13,
  current_date - 6,
  now() - interval '14 days',
  now() - interval '7 days'
) previous_scores;
