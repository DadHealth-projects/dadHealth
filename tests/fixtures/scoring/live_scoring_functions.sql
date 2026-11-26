-- Copied verbatim from production (read-only MCP, pg_get_functiondef, 2026-11-25 18:55 UTC).
CREATE OR REPLACE FUNCTION public.calculate_dad_score_period(p_user_id uuid, p_start_date date, p_end_date date, p_start_time timestamp with time zone, p_end_time timestamp with time zone)
 RETURNS TABLE(mind_score numeric, body_score numeric, bond_score numeric, mind_has_data boolean, body_has_data boolean, bond_has_data boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare config record; legacy_weights record; prior record; manual record; days integer; activity numeric; start_at timestamptz; end_at timestamptz; body_days integer; bond_days integer; body_activity numeric; bond_activity numeric; body_effective date;
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
  select effective_week_start into strict body_effective from public.body_bond_score_model_config where model_version='body_bond_70_30_v3';
  select manual_weight, checkin_weight, other_weight into strict legacy_weights
    from public.dad_score_model_config where model_version='60_40_10_30_v1';
  select count(distinct date) into days from public.mood_logs where user_id=p_user_id and date>=p_start_date and date<p_end_date and mood_value is not null;
  activity := public.calculate_mind_activity_points_v2(p_user_id,p_start_date,p_end_date);
  mind_score := least(coalesce(days,0),7)*10 + least(coalesce(activity,0)/config.activity_target,1)*30;
  mind_has_data := coalesce(days,0)>0 or coalesce(activity,0)>0;
   if p_start_date < body_effective then
     -- Preserve the exact Body/Bond implementation until the new model activates.
     -- Retain the v2 Body/Bond account-week source windows and configuration weights.
     body_has_data := exists(select 1 from public.mood_logs where user_id=p_user_id and date>=p_start_date and date<p_end_date and energy_level is not null);
     bond_has_data := exists(select 1 from public.mood_logs where user_id=p_user_id and date>=p_start_date and date<p_end_date and connection_level is not null);
     body_score := least(100,coalesce(manual.body_manual_points,0)*legacy_weights.manual_weight/70.0 + case when body_has_data then legacy_weights.checkin_weight else 0 end + greatest(0,coalesce(prior.body_score,0))*legacy_weights.other_weight/100.0);
     bond_score := least(100,coalesce(manual.bond_manual_points,0)*legacy_weights.manual_weight/70.0 + case when bond_has_data then legacy_weights.checkin_weight else 0 end + greatest(0,coalesce(prior.bond_score,0))*legacy_weights.other_weight/100.0);
     body_has_data := body_has_data or manual.body_manual_has_data or prior.body_has_data;
     bond_has_data := bond_has_data or manual.bond_manual_has_data or prior.bond_has_data;
   else
     select count(distinct date)::integer into body_days from public.mood_logs
       where user_id=p_user_id and date>=p_start_date and date<p_end_date and energy_level is not null;
     select count(distinct date)::integer into bond_days from public.mood_logs
       where user_id=p_user_id and date>=p_start_date and date<p_end_date and connection_level is not null;
     -- Manual records keep the existing one-winner-per-pillar-per-day protection.
     -- Other sources retain their established caps. Different sources may
     -- contribute, but no single source can exceed the 30-point activity pool.
     body_activity := least(1, greatest(0,coalesce(manual.body_manual_points,0))/28.0
       + least(100,greatest(0,coalesce(prior.body_score,0)))/100.0);
     bond_activity := least(1, greatest(0,coalesce(manual.bond_manual_points,0))/28.0
       + least(100,greatest(0,coalesce(prior.bond_score,0)))/100.0);
     body_score := least(coalesce(body_days,0),7)*10 + body_activity*30;
     bond_score := least(coalesce(bond_days,0),7)*10 + bond_activity*30;
     body_has_data := coalesce(body_days,0)>0 or coalesce(manual.body_manual_has_data,false) or coalesce(prior.body_has_data,false);
     bond_has_data := coalesce(bond_days,0)>0 or coalesce(manual.bond_manual_has_data,false) or coalesce(prior.bond_has_data,false);
   end if;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_manual_activity_period(p_user_id uuid, p_start_date date, p_end_date date)
 RETURNS TABLE(mind_manual_points numeric, body_manual_points numeric, bond_manual_points numeric, mind_manual_has_data boolean, body_manual_has_data boolean, bond_manual_has_data boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
