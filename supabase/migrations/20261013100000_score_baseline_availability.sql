-- Expose canonical baseline availability without changing score formulas.
-- A Monday signup can use that full calendar week. Midweek signups begin
-- baseline collection the following Monday. Change 07's effective week still
-- remains the earliest comparable scoring week.
create or replace function public.is_dad_score_baseline_available(
  p_created_at timestamptz,
  p_effective_week_start date,
  p_current_week_start date
)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select p_current_week_start > greatest(
    p_effective_week_start,
    coalesce(
      date_trunc('week', p_created_at)::date
        + case when extract(isodow from p_created_at) = 1 then 0 else 7 end,
      p_effective_week_start
    )
  );
$$;

revoke all on function public.is_dad_score_baseline_available(timestamptz, date, date) from public, anon;
grant execute on function public.is_dad_score_baseline_available(timestamptz, date, date) to authenticated, service_role;

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
  end as recommended_action,
  public.is_dad_score_baseline_available(
    p.created_at, score_config.effective_week_start, current_week.week_start
  ) as baseline_available
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

comment on column public.dad_score_view.baseline_available is
  'True after one complete Monday-Sunday scoring week, respecting signup week and Change 07 effective week.';
