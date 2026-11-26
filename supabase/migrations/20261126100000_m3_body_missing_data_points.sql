-- Milestone 3 scoring defect (found 2026-11-26, needs client approval before production).
-- PostgreSQL LEAST() ignores NULL, so with no rows `least(avg(x)/8*30, 30)` returned the CAP
-- (sleep 30, steps 20, active minutes 10) instead of 0: a member with no imported health data
-- received up to 60 phantom "other source" Body points, i.e. up to +18 Body score.
-- Confirmed on production 2026-11-26 (select least(null::numeric, 30) = 30).
-- Fix: missing data counts as 0 inside each cap. No other change: same caps, weights, sources,
-- signature, owner and grants. Saved weekly snapshots are immutable and are not rewritten;
-- live scores for the current week change at the next read.
-- Rollback: re-run calculate_dad_score_nonmanual_period_v2 from
-- 20261111120000_mind_participation_and_scoring_calendar.sql.
begin;

CREATE OR REPLACE FUNCTION public.calculate_dad_score_nonmanual_period_v2(p_user_id uuid, p_start_date date, p_end_date date, p_start_time timestamp with time zone, p_end_time timestamp with time zone)
 RETURNS TABLE(mind_score numeric, body_score numeric, bond_score numeric, mind_has_data boolean, body_has_data boolean, bond_has_data boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      + coalesce((select least(coalesce(avg(s.hours), 0) / 8 * 30, 30) from public.sleep_logs s
        where s.user_id = p_user_id and s.date >= p_start_date and s.date < p_end_date), 0)
      + coalesce((select least(coalesce(avg(bm.value), 0) / 10000 * 20, 20) from public.body_metrics bm
        where bm.user_id = p_user_id and bm.metric_type = 'steps' and bm.recorded_at >= p_start_time and bm.recorded_at < p_end_time), 0)
      + coalesce((select least(coalesce(avg(bm.value), 0) / 30 * 10, 10) from public.body_metrics bm
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
$function$;

revoke all on function public.calculate_dad_score_nonmanual_period_v2(uuid, date, date, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.calculate_dad_score_nonmanual_period_v2(uuid, date, date, timestamptz, timestamptz) to service_role;

commit;
