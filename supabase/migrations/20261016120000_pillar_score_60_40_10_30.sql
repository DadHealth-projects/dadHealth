begin;

-- Version the scoring transition separately from Change 07. Start on the next
-- Monday so no in-progress week mixes formulas. Future scoring models get rows.
create table if not exists public.dad_score_model_config (
  model_version text primary key,
  effective_week_start date not null check (extract(isodow from effective_week_start) = 1),
  manual_weight numeric not null check (manual_weight between 0 and 100),
  mind_checkin_weight numeric not null check (mind_checkin_weight between 0 and 100),
  checkin_weight numeric not null check (checkin_weight between 0 and 100),
  other_weight numeric not null check (other_weight between 0 and 100),
  created_at timestamptz not null default now(),
  constraint dad_score_model_config_mind_weights_sum_to_100
    check (manual_weight + mind_checkin_weight = 100),
  constraint dad_score_model_config_body_bond_weights_sum_to_100
    check (manual_weight + checkin_weight + other_weight = 100)
);

alter table public.dad_score_model_config enable row level security;
drop policy if exists dad_score_model_config_read on public.dad_score_model_config;
create policy dad_score_model_config_read on public.dad_score_model_config
  for select to authenticated using (true);
revoke all on public.dad_score_model_config from public, anon;
revoke insert, update, delete on public.dad_score_model_config from authenticated;
grant select on public.dad_score_model_config to authenticated, service_role;

insert into public.dad_score_model_config (
  model_version, effective_week_start, manual_weight, mind_checkin_weight, checkin_weight, other_weight
)
values (
  '60_40_10_30_v1', date_trunc('week', current_date)::date + 7, 60, 40, 10, 30
)
on conflict (model_version) do nothing;

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

revoke all on function public.calculate_dad_score_period(uuid, date, date, timestamptz, timestamptz) from public, anon;
grant execute on function public.calculate_dad_score_period(uuid, date, date, timestamptz, timestamptz) to authenticated, service_role;

-- Score shape stays compatible. Suppress trend comparison in the first full
-- week of the new formula; comparisons resume once both weeks use this model.
create or replace view public.dad_score_view
  with (security_invoker = true)
as
select
  p.user_id,
  current_scores.mind_score,
  current_scores.body_score,
  current_scores.bond_score::bigint as bond_score,
  case when previous_scores.mind_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start) then previous_scores.mind_score end as previous_mind_score,
  case when previous_scores.body_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start) then previous_scores.body_score end as previous_body_score,
  case when previous_scores.bond_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start) then previous_scores.bond_score end as previous_bond_score,
  case when previous_scores.mind_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start)
    then current_scores.mind_score - previous_scores.mind_score end as mind_week_change,
  case when previous_scores.body_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start)
    then current_scores.body_score - previous_scores.body_score end as body_week_change,
  case when previous_scores.bond_has_data and current_week.week_start > greatest(score_config.effective_week_start, model_config.effective_week_start)
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
    else model_config.model_version
  end as score_model_version
from public.user_profile p
cross join generate_series(0, 7) as offsets(week_offset)
cross join lateral (
  select (date_trunc('week', current_date)::date - (week_offset * 7))::date as week_start
) weeks
cross join public.activity_score_config activity_config
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
