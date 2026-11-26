-- Copied verbatim from production (read-only MCP, pg_get_functiondef, 2026-11-26).
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
$function$;

CREATE OR REPLACE FUNCTION public.calculate_mind_activity_points_v2(p_user_id uuid, p_start date, p_end date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;
