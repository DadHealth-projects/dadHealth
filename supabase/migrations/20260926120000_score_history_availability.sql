-- Preserve canonical weekly scores while identifying truly empty periods so
-- clients never draw generated zero weeks as real user history.
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
  scores.bond_has_data
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

comment on column public.dad_score_view.recommended_action is
  'Canonical next action. Mind breathing can repeat because completion is not persisted; do not infer completion without an approved tracking source.';
