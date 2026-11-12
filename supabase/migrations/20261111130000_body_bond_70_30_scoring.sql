-- CORRECTED DRAFT: Body/Bond 70/30 forward-only migration.
-- DEPENDENCY: apply 20261111120000_mind_participation_and_scoring_calendar.sql first.
-- IMPORTANT: Not executed against PostgreSQL; validate on a restored/staging database.
-- Do not run synthetic pgTAP fixtures on production.
-- Preserves historical scoring through the pre-Phase-2 delegate.
-- The activity_logs_validate_insert trigger is left unchanged by this migration.
begin;
create table if not exists public.body_bond_score_model_config (
 model_version text primary key check(model_version='body_bond_70_30_v3'),
 effective_week_start date not null check(extract(isodow from effective_week_start)=1)
);
insert into public.body_bond_score_model_config(model_version,effective_week_start)
values ('body_bond_70_30_v3',
 greatest((date_trunc('week',now() at time zone 'UTC')+interval '14 days')::date,
   (select effective_week_start from public.mind_score_model_config where model_version='mind_70_30_v2')))
on conflict(model_version) do nothing;
do $$
declare
  body_week date;
  mind_week date;
begin
  select effective_week_start into strict body_week
  from public.body_bond_score_model_config
  where model_version = 'body_bond_70_30_v3';

  select effective_week_start into strict mind_week
  from public.mind_score_model_config
  where model_version = 'mind_70_30_v2';

  if body_week < mind_week then
    raise exception 'Body/Bond activation must not precede Mind activation';
  end if;
end $$;
alter table public.body_bond_score_model_config enable row level security;
revoke all on public.body_bond_score_model_config from public,anon,authenticated;
grant select on public.body_bond_score_model_config to authenticated;
grant all on public.body_bond_score_model_config to service_role;
drop policy if exists body_bond_score_model_read on public.body_bond_score_model_config;
create policy body_bond_score_model_read on public.body_bond_score_model_config for select to authenticated using(true);

create or replace function public.calculate_dad_score_period(
 p_user_id uuid,p_start_date date,p_end_date date,p_start_time timestamptz,p_end_time timestamptz
) returns table(mind_score numeric,body_score numeric,bond_score numeric,mind_has_data boolean,body_has_data boolean,bond_has_data boolean)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
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
$$;

create or replace view public.dad_score_view
  with (security_invoker = true)
as
select
  p.user_id,
  current_scores.mind_score,
  current_scores.body_score,
  current_scores.bond_score::bigint as bond_score,
  case when previous_scores.mind_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start, case when current_week.week_start >= mind_model.effective_week_start then mind_model.effective_week_start else model_config.effective_week_start end, case when current_week.week_start >= body_bond_model.effective_week_start then body_bond_model.effective_week_start else model_config.effective_week_start end) then previous_scores.mind_score end as previous_mind_score,
  case when previous_scores.body_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start, case when current_week.week_start >= mind_model.effective_week_start then mind_model.effective_week_start else model_config.effective_week_start end, case when current_week.week_start >= body_bond_model.effective_week_start then body_bond_model.effective_week_start else model_config.effective_week_start end) then previous_scores.body_score end as previous_body_score,
  case when previous_scores.bond_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start, case when current_week.week_start >= mind_model.effective_week_start then mind_model.effective_week_start else model_config.effective_week_start end, case when current_week.week_start >= body_bond_model.effective_week_start then body_bond_model.effective_week_start else model_config.effective_week_start end) then previous_scores.bond_score end as previous_bond_score,
  case when previous_scores.mind_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start, case when current_week.week_start >= mind_model.effective_week_start then mind_model.effective_week_start else model_config.effective_week_start end, case when current_week.week_start >= body_bond_model.effective_week_start then body_bond_model.effective_week_start else model_config.effective_week_start end)
    then current_scores.mind_score - previous_scores.mind_score end as mind_week_change,
  case when previous_scores.body_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start, case when current_week.week_start >= mind_model.effective_week_start then mind_model.effective_week_start else model_config.effective_week_start end, case when current_week.week_start >= body_bond_model.effective_week_start then body_bond_model.effective_week_start else model_config.effective_week_start end)
    then current_scores.body_score - previous_scores.body_score end as body_week_change,
  case when previous_scores.bond_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start, case when current_week.week_start >= mind_model.effective_week_start then mind_model.effective_week_start else model_config.effective_week_start end, case when current_week.week_start >= body_bond_model.effective_week_start then body_bond_model.effective_week_start else model_config.effective_week_start end)
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
 cross join public.body_bond_score_model_config body_bond_model
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
    when weeks.week_start < body_bond_model.effective_week_start then mind_model.model_version
    else body_bond_model.model_version
  end as score_model_version
from public.user_profile p
cross join generate_series(0, 7) as offsets(week_offset)
cross join lateral (
  select (date_trunc('week', public.scoring_current_date(p.user_id))::date - (week_offset * 7))::date as week_start
) weeks
cross join public.activity_score_config activity_config
cross join public.mind_score_model_config mind_model
 cross join public.body_bond_score_model_config body_bond_model
cross join (
  select * from public.dad_score_model_config where model_version = '60_40_10_30_v1'
) model_config
cross join lateral public.calculate_dad_score_period(
  p.user_id, weeks.week_start, weeks.week_start + 7,
  weeks.week_start::timestamptz, (weeks.week_start + 7)::timestamptz
) scores;

revoke all on public.dad_score_history_view from anon, authenticated;
grant select on public.dad_score_history_view to service_role;
commit;
