-- Correct the release contract without rewriting applied migrations or snapshots.
-- Run as the migration owner. Any incompatible existing row aborts the entire
-- migration for review; never rewrite or delete immutable report history.
begin;
lock table public.weekly_report_snapshots in access exclusive mode;
do $$
begin
  if exists (
    select 1 from public.weekly_report_snapshots
    where delivery_at is distinct from
      (((reporting_week_start + 6)::timestamp + interval '6 hours') at time zone 'Europe/London')
  ) then
    raise exception 'Existing weekly snapshots require release compatibility review'
      using errcode = '23514';
  end if;
end $$;
alter table public.weekly_report_snapshots drop constraint weekly_report_release;
alter table public.weekly_report_snapshots add constraint weekly_report_release check (
  delivery_at = ((reporting_week_start + 6)::timestamp + interval '6 hours') at time zone 'Europe/London'
);

-- Reproduce the four live function corrections in forward migration history.
-- Apart from the release hour these definitions retain their existing behaviour.
create or replace function public.validate_weekly_report_observation(
  p_user_id uuid, p_week date, p_observed_at timestamptz
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  first_at timestamptz;
  last_at timestamptz;
  today date;
  mind_model record;
  body_model record;
  legacy_model record;
  scores record;
begin
  if p_user_id is null or p_week is null or p_observed_at is null
    or not isfinite(p_observed_at) or extract(isodow from p_week) <> 1 then
    raise exception 'Invalid report observation' using errcode='22023';
  end if;
  if p_observed_at <
    ((p_week + 6)::timestamp + interval '6 hours')
      at time zone 'Europe/London'
  then
    return jsonb_build_object(
      'state', 'unavailable',
      'reason', 'before_release'
    );
  end if;
  if not exists(select 1 from public.user_profile where user_id=p_user_id) then
    return jsonb_build_object('state','unavailable','reason','profile_missing');
  end if;
  select * into strict mind_model from public.mind_score_model_config where model_version='mind_70_30_v2';
  select * into strict body_model from public.body_bond_score_model_config where model_version='body_bond_70_30_v3';
  select * into strict legacy_model from public.dad_score_model_config where model_version='60_40_10_30_v1';
  -- Legacy weeks use UTC in the existing display/scoring contract.
  if p_week < mind_model.effective_week_start then
    first_at := p_week::timestamp at time zone 'UTC';
    last_at := (p_week+7)::timestamp at time zone 'UTC';
    today := (p_observed_at at time zone 'UTC')::date;
  else
    first_at := public.scoring_week_boundary(p_user_id,p_week);
    last_at := public.scoring_week_boundary(p_user_id,p_week+7);
    today := public.scoring_date_at(p_user_id,p_observed_at);
  end if;
  if first_at >= last_at or p_observed_at <= first_at then
    return jsonb_build_object('state','unavailable','reason','invalid_calendar');
  end if;
  -- Do not manufacture timestamps for date-only participation. Same-day rows
  -- remain eligible, including offline records already visible in this snapshot.
  if exists (
    select 1 from (
      select date as day from public.mood_logs where user_id=p_user_id
      union all select date from public.sleep_logs where user_id=p_user_id
      union all select activity_date from public.activity_logs where user_id=p_user_id
      union all select activity_date from public.mind_reset_sessions where user_id=p_user_id
      union all select coalesce(scoring_date,
        (created_at at time zone public.scoring_timezone_at(user_id,created_at))::date)
        from public.journal_entries where user_id=p_user_id and p_week>=mind_model.effective_week_start
    ) dates where day>=p_week and day<p_week+7 and day>today
  ) or exists (
    select 1 from (
      select performed_at as at from public.workout_sessions where user_id=p_user_id
      union all select recorded_at from public.body_metrics where user_id=p_user_id and metric_type in ('steps','active_mins')
      union all select created_at from public.journal_entries where user_id=p_user_id
      union all select created_at from public.bond_logs where user_id=p_user_id
      union all select completed_at from public.present_dad_sessions where user_id=p_user_id and status='completed'
    ) events where at>=first_at and at<last_at and at>p_observed_at
  ) or exists (
    -- Mind journal attribution can differ from its Bond timestamp window.
    select 1 from public.journal_entries j where j.user_id=p_user_id
      and p_week>=mind_model.effective_week_start
      and coalesce(j.scoring_date,(j.created_at at time zone public.scoring_timezone_at(j.user_id,j.created_at))::date)>=p_week
      and coalesce(j.scoring_date,(j.created_at at time zone public.scoring_timezone_at(j.user_id,j.created_at))::date)<p_week+7
      and j.created_at>p_observed_at
  ) then
    return jsonb_build_object('state','unavailable','reason','future_contribution');
  end if;
  -- STABLE keeps all dependency reads (including custody schedules, model
  -- configuration and timezone history inside canonical helpers) on the calling
  -- statement's MVCC snapshot. This function alone does NOT publish a report.
  select * into strict scores from public.calculate_dad_score_period(
    p_user_id,p_week,p_week+7,first_at,last_at);
  return jsonb_build_object('state','available','observedAt',p_observed_at,
    'startsAt',first_at,'endsAtExclusive',last_at,'accountDate',today,
    'scores',to_jsonb(scores),
    'modelConfiguration',jsonb_build_object('mind',to_jsonb(mind_model),
      'bodyBond',to_jsonb(body_model),'legacy',to_jsonb(legacy_model)));
end;
$$;
revoke all on function public.validate_weekly_report_observation(uuid,date,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.build_weekly_report_candidate(uid uuid, wk date, observed timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare
 v jsonb; prior jsonb; payload jsonb; pillars jsonb := '{}'::jsonb;
 cmp jsonb; period jsonb; key text; score numeric; prior_score numeric;
 first_at timestamptz; last_at timestamptz; cutoff timestamptz; zone text;
 model text; weakest text; focus_action text; focus_text text;
 workouts bigint; bonds bigint; checkins bigint; streak integer; freezes jsonb;
 created timestamptz; effective date; comparable boolean := false;
begin
 v:=public.validate_weekly_report_observation(uid,wk,observed);
 if v->>'state'<>'available' then return v; end if;
 first_at:=(v->>'startsAt')::timestamptz;
 last_at:=(v->>'endsAtExclusive')::timestamptz;
 cutoff:=least(observed,last_at);
 zone:=case when wk<(v#>>'{modelConfiguration,mind,effective_week_start}')::date then 'UTC'
   else public.scoring_timezone_at(uid,first_at) end;
 -- Include configuration values in the comparison identity, not only names.
 model:=case
   when wk<(v#>>'{modelConfiguration,legacy,effective_week_start}')::date then 'pre_60_40'
   when wk<(v#>>'{modelConfiguration,mind,effective_week_start}')::date then '60_40_10_30_v1'
   when wk<(v#>>'{modelConfiguration,bodyBond,effective_week_start}')::date then 'mind_70_30_v2'
   else 'body_bond_70_30_v3' end || ':' || (v->'modelConfiguration')::text;
 -- A reset carries a real completion timestamp as well as a scoring date.
 if exists(select 1 from public.mind_reset_sessions where user_id=uid
   and activity_date>=wk and activity_date<wk+7 and completed_at>observed) then
   return jsonb_build_object('state','unavailable','reason','future_contribution');
 end if;
 period:=jsonb_build_object('weekStart',wk,'weekEndExclusive',wk+7,
   'startsAt',first_at,'endsAtExclusive',last_at,'accountTimezone',zone,'scoringModel',model);
 select s.payload into prior from public.weekly_report_snapshots s
   where s.user_id=uid and s.reporting_week_start=wk-7;
 select p.created_at into strict created from public.user_profile p where p.user_id=uid;
 select effective_week_start into strict effective from public.activity_score_config where singleton;
 if not public.is_dad_score_baseline_available(created,effective,wk) then
   cmp:=jsonb_build_object('state','unavailable','reason','incomplete_history');
 elsif prior is null then
   cmp:=jsonb_build_object('state','unavailable','reason','snapshot_missing');
 elsif prior#>>'{period,scoringModel}'<>model then
   cmp:=jsonb_build_object('state','unavailable','reason','model_mismatch');
 elsif prior#>>'{period,accountTimezone}'<>zone then
   cmp:=jsonb_build_object('state','unavailable','reason','calendar_mismatch');
 else
   comparable:=((cutoff at time zone zone)-wk::timestamp)
      =(((prior->>'cutoffAt')::timestamptz at time zone zone)-(wk-7)::timestamp)
     and ((observed at time zone zone)-wk::timestamp)
      =(((prior->>'capturedAt')::timestamptz at time zone zone)-(wk-7)::timestamp)
     and (cutoff=last_at)=((prior->>'cutoffAt')::timestamptz=(prior#>>'{period,endsAtExclusive}')::timestamptz);
   cmp:=case when comparable then jsonb_build_object('state','available',
     'previousPeriod',prior->'period','previousWeekComplete',true,'policy','matched_cutoff','policyApproved',true,
     'currentComparedThrough',cutoff,'previousComparedThrough',prior->'cutoffAt',
     'previousCapturedAt',prior->'capturedAt','previousDeliveryAt',prior->'deliveryAt')
     else jsonb_build_object('state','unavailable','reason','observation_mismatch') end;
 end if;
 foreach key in array array['mind','body','bond'] loop
   score:=(v->'scores'->>(key||'_score'))::numeric;
   prior_score:=(prior->'pillars'->key->'score'->>'value')::numeric;
   pillars:=pillars||jsonb_build_object(key,jsonb_build_object(
     'score',jsonb_build_object('state','available','value',score),
     'changePoints',case when comparable and prior_score is not null then
       jsonb_build_object('state','available','value',score-prior_score)
       else jsonb_build_object('state','unavailable') end));
 end loop;
 select count(*) into workouts from public.workout_sessions
   where user_id=uid and performed_at>=first_at and performed_at<last_at and performed_at<=observed;
 select count(*) into bonds from (
   select 'bond' as source,id from public.bond_logs where user_id=uid and created_at>=first_at and created_at<last_at and created_at<=observed
   union select 'present',id from public.present_dad_sessions where user_id=uid and status='completed'
     and completed_at>=first_at and completed_at<last_at and completed_at<=observed
 ) sessions;
 select count(distinct date) into checkins from public.mood_logs
   where user_id=uid and date>=wk and date<wk+7 and date<=(v->>'accountDate')::date;
 select streak_count into streak from public.user_streaks where user_id=uid;
 select coalesce(jsonb_agg(missed_date order by missed_date),'[]'::jsonb) into freezes
   from public.user_streak_freezes where user_id=uid and missed_date>=wk and missed_date<wk+7 and missed_date<=(v->>'accountDate')::date;
 -- Canonical dad_score_view tie order: Mind, then Body, then Bond.
 select k into weakest from unnest(array['mind','body','bond']) with ordinality as x(k,priority)
   order by (v->'scores'->>(k||'_score'))::numeric,priority limit 1;
 focus_action:=case weakest when 'mind' then 'mind_breathing' when 'body' then 'body_workout' else 'bond_present_mode' end;
 focus_text:=case weakest when 'mind' then 'Take a two-minute Mind reset' when 'body' then 'Move your body' else 'Make time to connect' end;
 payload:=jsonb_build_object('version',2,'period',period,
   'deliveryAt',((wk+6)::timestamp+interval '6 hours') at time zone 'Europe/London',
   'capturedAt',observed,'cutoffAt',cutoff,'comparison',cmp,'pillars',pillars,
   'details',jsonb_build_object('workouts',jsonb_build_object('state','available','value',workouts),
     'bondSessions',jsonb_build_object('state','available','value',bonds),
     'checkins',jsonb_build_object('state','available','value',checkins),
     'streak',jsonb_build_object('days',case when streak is null then jsonb_build_object('state','missing')
       else jsonb_build_object('state','available','value',streak) end,'protectedDates',freezes),
     'narrative',null,'focus',jsonb_build_object('pillar',weakest,'action',focus_action,'text',focus_text)));
 return jsonb_build_object('state','available','snapshot',payload);
end $$;
revoke all on function public.build_weekly_report_candidate(uuid,date,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.capture_weekly_report_snapshot(p_user_id uuid, p_week_start date)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if p_user_id is null or p_week_start is null or not isfinite(p_week_start)
     or extract(isodow from p_week_start)<>1 then
    raise exception 'Invalid report request' using errcode='22023';
  end if;
  if not exists(select 1 from auth.users where id=p_user_id) then
    raise exception 'Report account unavailable' using errcode='22023';
  end if;
  if clock_timestamp() < ((p_week_start+6)::timestamp+interval '6 hours') at time zone 'Europe/London' then
    return jsonb_build_object('state','unavailable','reason','not_released');
  end if;
  -- Candidate owns locking, post-lock observation, validation and atomic INSERT.
  -- No supplied payload, tier or observation timestamp can bypass its checks.
  return public.capture_weekly_report_candidate(p_user_id,p_week_start);
end;
$$;
revoke all on function public.capture_weekly_report_snapshot(uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.capture_weekly_report_snapshot(uuid,date) to service_role;

create or replace function public.list_item02_due_accounts(p_week_start date)
returns table(user_id uuid) language plpgsql security definer set search_path=pg_catalog,public as $$
declare observed timestamptz:=clock_timestamp(); london_day date; latest date;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  london_day:=(observed at time zone 'Europe/London')::date;
  latest:=date_trunc('week',london_day)::date;
  if observed<((latest+6)::timestamp+interval '6 hours') at time zone 'Europe/London' then latest:=latest-7; end if;
  if p_week_start is distinct from latest then raise exception 'Invalid released week' using errcode='22023'; end if;
  return query
with picked as (
  select p.user_id from public.user_profile p
    join public.streak_reconciliation_state s on s.user_id=p.user_id
    where s.activation_at<=observed and (
      s.state<>'current' or s.reconciled_through is null
      or s.reconciled_through<public.scoring_date_at(p.user_id,observed)-1
      or not exists(select 1 from public.weekly_report_snapshots r where r.user_id=p.user_id and r.reporting_week_start=p_week_start)
      or (p.push_notifications_enabled and exists(select 1 from public.notification_preferences n
          where n.user_id=p.user_id and n.notification_type='weekly_score' and n.enabled)
        and not exists(select 1 from public.notification_delivery_claims c where c.user_id=p.user_id
          and c.type='weekly_score' and c.event_key='weekly-report:'||p_week_start::text and c.completed_at is not null)))
      order by s.item02_selected_at nulls first, p.user_id
  limit 100
  for update of s skip locked
)
update public.streak_reconciliation_state s
set item02_selected_at = observed
from picked
where s.user_id = picked.user_id
returning s.user_id;
end $$;
revoke all on function public.list_item02_due_accounts(date) from public,anon,authenticated,service_role;
grant execute on function public.list_item02_due_accounts(date) to service_role;

create or replace function public.reconcile_and_capture_weekly_report(p_user_id uuid, p_week_start date)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare status jsonb; result jsonb; captured timestamptz; failure_state text; failure_constraint text;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if p_user_id is null or p_week_start is null or not isfinite(p_week_start) or extract(isodow from p_week_start)<>1 then
    raise exception 'Invalid report request' using errcode='22023';
  end if;
  -- Consistent ordering: streak lock then the existing A/B user/week lock.
  perform pg_advisory_xact_lock(hashtextextended('streak:'||p_user_id::text,0));
  status:=public.reconcile_checkin_streak(p_user_id);
  if status->>'state' is distinct from 'current' then
    return jsonb_build_object('state','unavailable','reason','streak_not_current');
  end if;
  -- A failed capture rolls back its own writes while retaining successful daily
  -- reconciliation, so a repeatedly failing account does not monopolize the batch.
  begin
  result:=public.capture_weekly_report_snapshot(p_user_id,p_week_start);
  if result->>'state'='available' then
    captured:=(result#>>'{snapshot,capturedAt}')::timestamptz;
    -- If midnight crossed between reconciliation and capture, roll back the
    -- capture rather than commit a snapshot with yesterday's count.
    if captured is null
  or (status->>'through')::date is null
      or (status->>'through')::date < public.scoring_date_at(p_user_id,captured)-1 then
      raise exception 'Streak reconciliation crossed a day boundary' using errcode='40001';
    end if;
    return jsonb_build_object('state','available','week',p_week_start);
  end if;
  return jsonb_build_object('state','unavailable','reason',result->>'reason');
  exception when others then
    get stacked diagnostics failure_state = returned_sqlstate, failure_constraint = constraint_name;
    -- Server diagnostics only: never log SQLERRM, DETAIL, identity or payload.
    raise log 'weekly_report_capture_failed sqlstate=% constraint=%', failure_state, failure_constraint;
    return jsonb_build_object('state','unavailable','reason','capture_failed');
  end;
end $$;
revoke all on function public.reconcile_and_capture_weekly_report(uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.reconcile_and_capture_weekly_report(uuid,date) to service_role;

commit;
