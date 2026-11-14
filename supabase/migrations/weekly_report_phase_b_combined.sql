-- Dad Health Phase B: consolidated execution bundle.
-- Original migration files are preserved as migration history.
-- Executes all four stages in order inside one transaction.
-- Final state: trusted service-role publication ENABLED; candidates owner-only.
-- Source comments describe intermediate/historical states, not final status.
-- No scheduler, mobile integration or notification delivery is included.

begin;

-- SOURCE: 20261113200000_weekly_report_snapshots.sql
-- Phase B: unapplied, forward-only storage foundation. No scoring objects change.
-- PUBLICATION IS DISABLED pending isolated canonical capture accuracy tests.
-- calculate_dad_score_period (20261111130000) replaces timestamp arguments with
-- full account-week boundaries after model activation. Its dependencies mix
-- date-only mood/sleep/manual/reset/journal dates with performed_at, recorded_at,
-- created_at and completed_at. Mutable edits/deletes and timezone history also
-- affect observations. Filtering report counts is NOT proof of score accuracy.
-- No caller flag, setting, or client payload can bypass this publication gate.
-- A subsequent reviewed capture implementation must use one MVCC statement for
-- canonical scores, counts, context, comparisons and insertion, with local tests.
-- Bond rule once capture is proven: distinct (source, record_id), not heuristic
-- cross-source real-world deduplication. Existing records have no shared identity.

create table if not exists public.weekly_report_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  reporting_week_start date not null,
  delivery_at timestamptz not null,
  captured_at timestamptz not null,
  payload jsonb not null,
  primary key (user_id, reporting_week_start),
  constraint weekly_report_monday check (extract(isodow from reporting_week_start) = 1),
  constraint weekly_report_release check (
    delivery_at = ((reporting_week_start + 6)::timestamp + interval '18 hours') at time zone 'Europe/London'
  ),
  constraint weekly_report_observed_after_release check (captured_at >= delivery_at),
  constraint weekly_report_payload_metadata check ((
    jsonb_typeof(payload) = 'object'
    and payload->>'version' = '2'
    and (payload#>>'{period,weekStart}')::date = reporting_week_start
    and (payload#>>'{period,weekEndExclusive}')::date = reporting_week_start + 7
    and (payload->>'deliveryAt')::timestamptz = delivery_at
    and (payload->>'capturedAt')::timestamptz = captured_at
    and (payload#>>'{period,startsAt}')::timestamptz < (payload->>'cutoffAt')::timestamptz
    and (payload#>>'{period,endsAtExclusive}')::timestamptz > (payload#>>'{period,startsAt}')::timestamptz
    and (payload->>'cutoffAt')::timestamptz = least(captured_at, (payload#>>'{period,endsAtExclusive}')::timestamptz)
    and length(payload#>>'{period,accountTimezone}') > 0
    and length(payload#>>'{period,scoringModel}') > 0
    and jsonb_typeof(payload->'pillars') = 'object'
    and jsonb_typeof(payload->'comparison') = 'object'
    and jsonb_typeof(payload->'details') = 'object'
  ) is true)
);

alter table public.weekly_report_snapshots enable row level security;
revoke all on public.weekly_report_snapshots from public, anon, authenticated, service_role;
-- Server reads only. Even service_role cannot directly publish, update or delete.
grant select on public.weekly_report_snapshots to service_role;

create or replace function public.reject_weekly_report_rewrite()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'Weekly reports are immutable' using errcode = '55000';
end;
$$;
revoke all on function public.reject_weekly_report_rewrite() from public, anon, authenticated, service_role;
drop trigger if exists reject_weekly_report_rewrite on public.weekly_report_snapshots;
create trigger reject_weekly_report_rewrite before update on public.weekly_report_snapshots
  for each row execute function public.reject_weekly_report_rewrite();
-- Account deletion still cascades through auth.users. Do not obstruct privacy cleanup.

create or replace function public.capture_weekly_report_snapshot(p_user_id uuid, p_week_start date)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  release_at timestamptz;
  saved jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
  raise exception 'Service role required' using errcode = '42501';
end if;
  if p_user_id is null or p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'Invalid report request' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Report account unavailable' using errcode = '22023';
  end if;
  release_at := ((p_week_start + 6)::timestamp + interval '18 hours') at time zone 'Europe/London';
  if statement_timestamp() < release_at then
    return jsonb_build_object('state', 'unavailable', 'reason', 'not_released');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('weekly-report:' || p_user_id::text || ':' || p_week_start::text, 0));
  select payload into saved from public.weekly_report_snapshots
    where user_id = p_user_id and reporting_week_start = p_week_start;
  if found then
    return jsonb_build_object('state', 'available', 'snapshot', saved);
  end if;
  -- Deliberately no score call or INSERT: no partial, invented or unproven report.
  -- Do not replace this with independent score arithmetic or a runtime opt-in.
  return jsonb_build_object('state', 'unavailable', 'reason', 'canonical_capture_unverified');
end;
$$;
revoke all on function public.capture_weekly_report_snapshot(uuid, date) from public, anon, authenticated;
grant execute on function public.capture_weekly_report_snapshot(uuid, date) to service_role;

-- SOURCE: 20261114090000_weekly_report_capture_validation.sql
-- Forward-only, report-only validation primitive. PUBLICATION REMAINS DISABLED.
-- No grant to service_role: this is available only to the migration owner for
-- isolated proof until the complete generator and its safety tests are approved.

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
    ((p_week + 6)::timestamp + interval '18 hours')
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

-- SOURCE: 20261114100000_weekly_report_generator.sql
-- Owner-only candidate generator. The public capture RPC remains DISABLED.
-- Do not grant execution or enable publication before isolated acceptance.
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
   'deliveryAt',((wk+6)::timestamp+interval '18 hours') at time zone 'Europe/London',
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

create or replace function public.capture_weekly_report_candidate(uid uuid,wk date)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare result jsonb; saved jsonb;
begin
 if uid is null or wk is null or extract(isodow from wk)<>1 then
   raise exception 'Invalid report request' using errcode='22023';
 end if;
 -- A fresh READ COMMITTED statement after this lock must observe the winner.
 if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'Capture requires read committed isolation' using errcode='25000';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('weekly-report:'||uid::text||':'||wk::text,0));
 select payload into saved from public.weekly_report_snapshots where user_id=uid and reporting_week_start=wk;
 if found then return jsonb_build_object('state','available','snapshot',saved); end if;
 -- The STABLE builder and INSERT share this one statement's MVCC snapshot.
 with observation as materialized (select clock_timestamp() as at),
 candidate as materialized (select public.build_weekly_report_candidate(uid,wk,at) as value from observation),
 inserted as (
   insert into public.weekly_report_snapshots(user_id,reporting_week_start,delivery_at,captured_at,payload)
   select uid,wk,(value#>>'{snapshot,deliveryAt}')::timestamptz,
     (value#>>'{snapshot,capturedAt}')::timestamptz,value->'snapshot'
   from candidate where value->>'state'='available' returning payload
 ) select value into result from candidate;
 return result;
end $$;
revoke all on function public.capture_weekly_report_candidate(uuid,date) from public,anon,authenticated,service_role;
-- Deliberately leave capture_weekly_report_snapshot unchanged and disabled.

-- SOURCE: 20261114110000_weekly_report_publication.sql
-- RELEASE GATE: DO NOT APPLY TO PRODUCTION until full acceptance and approval.
-- Applying this migration enables trusted server capture, not a scheduler.
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
  if clock_timestamp() < ((p_week_start+6)::timestamp+interval '18 hours') at time zone 'Europe/London' then
    return jsonb_build_object('state','unavailable','reason','not_released');
  end if;
  -- Candidate owns locking, post-lock observation, validation and atomic INSERT.
  -- No supplied payload, tier or observation timestamp can bypass its checks.
  return public.capture_weekly_report_candidate(p_user_id,p_week_start);
end;
$$;
revoke all on function public.capture_weekly_report_snapshot(uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.capture_weekly_report_snapshot(uuid,date) to service_role;

commit;
