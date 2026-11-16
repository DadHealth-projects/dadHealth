-- Item 03 Phase 1 only. No inbox, scheduler replacement or secret values.
begin;
do $$ begin
  if to_regprocedure('public.scoring_date_at(uuid,timestamp with time zone)') is null
    or to_regprocedure('public.scoring_timezone_at(uuid,timestamp with time zone)') is null
    or to_regclass('public.notification_weekly_report_identity') is null
    or to_regclass('public.idx_notification_log_delivery_claim_unique') is null
    or to_regprocedure('public.complete_notification_delivery(uuid,text)') is null then
    raise exception 'Item 03 requires installed Item 02 calendar and delivery prerequisites';
  end if;
end $$;

-- Extend installed type checks using their actual names and expressions.
-- Preserve existing allowed types, unrelated checks and validation status.
do $$
declare
  tbl text;
  col text;
  relation_id regclass;
  column_number smallint;
  constraint_row record;
  checks_found integer;
begin
  foreach tbl in array array[
    'notification_preferences',
    'notification_delivery_claims',
    'notification_log'
  ] loop
    col := case
      when tbl = 'notification_preferences' then 'notification_type'
      else 'type'
    end;

    relation_id := to_regclass(format('public.%I', tbl));

    if relation_id is null then
      raise exception 'Missing prerequisite table: public.%', tbl;
    end if;

    select attnum into column_number
    from pg_attribute
    where attrelid = relation_id
      and attname = col
      and not attisdropped;

    if column_number is null then
      raise exception 'Missing prerequisite column: %.%', tbl, col;
    end if;

    if exists (
      select 1
      from pg_constraint
      where conrelid = relation_id
        and contype = 'c'
        and column_number = any(conkey)
        and cardinality(conkey) <> 1
    ) then
      raise exception
        'Cross-column type constraint on public.% requires explicit review',
        tbl;
    end if;

    checks_found := 0;

    for constraint_row in
      select conname, convalidated,
             pg_get_expr(conbin, conrelid) as expression
      from pg_constraint
      where conrelid = relation_id
        and contype = 'c'
        and conkey = array[column_number]::smallint[]
    loop
      checks_found := checks_found + 1;

      execute format(
        'alter table public.%I drop constraint %I',
        tbl, constraint_row.conname
      );

      execute format(
        'alter table public.%I add constraint %I
         check ((%s) or %I in (''lowest_pillar'', ''trial_ending''))%s',
        tbl,
        constraint_row.conname,
        constraint_row.expression,
        col,
        case when constraint_row.convalidated then '' else ' not valid' end
      );
    end loop;

    if checks_found = 0 then
      raise exception
        'No installed type check found on public.%.%; review required',
        tbl, col;
    end if;
  end loop;
end $$;

create table public.notification_trial_episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id uuid not null references public.subscription_entitlements(id) on delete cascade,
  provider text not null check(provider='apple'),
  environment text not null,
  transaction_id text not null,
  started_at timestamptz not null,
  ends_at timestamptz not null check(ends_at>started_at),
  verified_at timestamptz not null,
  unique(provider,environment,transaction_id)
);
alter table public.notification_trial_episodes enable row level security;
revoke all on public.notification_trial_episodes from public,anon,authenticated;
grant select,insert on public.notification_trial_episodes to service_role;

-- Called only with server-verified Apple facts, after the existing entitlement
-- writer. An old transaction cannot create current trial evidence for a newer row.
create function public.record_notification_trial(p_subscription_id uuid,p_user_id uuid,
 p_transaction_id text,p_started_at timestamptz,p_ends_at timestamptz,p_environment text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.subscription_entitlements%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into s
 from public.subscription_entitlements
 where id=p_subscription_id
 for share;

 if not found then
   raise exception 'Subscription not found' using errcode='22023';
 end if;

 if s.user_id is distinct from p_user_id or s.provider is distinct from 'apple'
   or s.environment is distinct from p_environment then raise exception 'Trial owner mismatch' using errcode='42501'; end if;
 if s.status<>'trialing' or s.latest_transaction_id is distinct from p_transaction_id
   or s.trial_end is distinct from p_ends_at then return; end if;
 if p_transaction_id is null or p_started_at is null or p_ends_at is null
   or not isfinite(p_started_at) or not isfinite(p_ends_at)
   or p_started_at>=p_ends_at or p_started_at>clock_timestamp() then
   raise exception 'Invalid verified trial facts' using errcode='22023'; end if;
 insert into public.notification_trial_episodes(user_id,subscription_id,provider,environment,transaction_id,started_at,ends_at,verified_at)
 values(p_user_id,s.id,'apple',p_environment,p_transaction_id,p_started_at,p_ends_at,clock_timestamp())
 on conflict(provider,environment,transaction_id) do nothing;
 if not exists(select 1 from public.notification_trial_episodes where user_id=p_user_id
   and subscription_id=s.id and environment=p_environment and transaction_id=p_transaction_id
   and started_at=p_started_at and ends_at=p_ends_at) then
   raise exception 'Conflicting trial facts' using errcode='22023'; end if;
end $$;
revoke all on function public.record_notification_trial(uuid,uuid,text,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.record_notification_trial(uuid,uuid,text,timestamptz,timestamptz,text) to service_role;

-- New identities only; historical delivery records are not rewritten.
create unique index notification_daily_nudge_identity on public.notification_delivery_claims(user_id,event_key)
 where type in ('morning_checkin','lowest_pillar') and event_key like 'daily:%';
create unique index notification_trial_identity on public.notification_delivery_claims(user_id,event_key)
 where type='trial_ending' and event_key like 'trial:%';

create function public.item03_notification_context(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare at_time timestamptz:=clock_timestamp(); zone text; day date; local_time time;
 scheduled time; daily text; pillar text; episodes jsonb; scores record;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if not exists(select 1 from public.user_profile where user_id=p_user_id and push_notifications_enabled) then
   return jsonb_build_object('allowed',false); end if;
 -- Require real calendar evidence: do not silently use the calendar helper's UTC fallback.
 zone:=public.scoring_timezone_at(p_user_id,at_time);
 if not exists(select 1 from public.scoring_timezone_history where user_id=p_user_id and effective_at<=at_time)
   and not exists(select 1 from public.user_profile p join pg_timezone_names z on z.name=p.timezone where p.user_id=p_user_id) then
   return jsonb_build_object('allowed',false); end if;
 if not exists(select 1 from pg_timezone_names where name=zone) then return jsonb_build_object('allowed',false); end if;
 day:=public.scoring_date_at(p_user_id,at_time);
 local_time:=(at_time at time zone zone)::time;
 if local_time<time '08:00' or local_time>=time '21:00' then return jsonb_build_object('allowed',false); end if;
 select coalesce(send_time,time '08:00') into scheduled from public.notification_preferences
   where user_id=p_user_id and notification_type='morning_checkin';
 scheduled:=coalesce(scheduled,time '08:00');

-- Preserve stored reminder preferences.
-- NULL defaults to 08:00; legacy 07:30 is effectively deferred to 08:00.
-- Other unsupported times require an explicit Settings selection.
if scheduled=time '07:30' then
  scheduled:=time '08:00';
end if;
 if scheduled>=time '08:00' and scheduled<=time '20:45' and extract(second from scheduled)=0
   and mod(extract(minute from scheduled)::integer,15)=0
   and local_time>=scheduled and local_time<scheduled+interval '15 minutes' then
   if not exists(select 1 from public.mood_logs where user_id=p_user_id and date=day) then
     if exists(select 1 from public.notification_preferences where user_id=p_user_id and notification_type='morning_checkin' and enabled) then daily:='morning_checkin'; end if;
   elsif exists(select 1 from public.notification_preferences where user_id=p_user_id and notification_type='lowest_pillar' and enabled) then
     select mind_score,body_score,bond_score,weakest_pillar into scores from public.dad_score_view where user_id=p_user_id;
     if scores.mind_score is not null and scores.body_score is not null and scores.bond_score is not null then
       pillar:=scores.weakest_pillar;
       if pillar in ('mind','body','bond') then daily:='lowest_pillar'; end if;
       if pillar='body' and not exists(select 1 from public.workouts where id='89e97b6c-0bfa-407d-a9f4-5020b086ba11'
         and source='admin' and access_level='free' and duration_mins=10) then daily:=null; end if;
     end if;
   end if;
 end if;
 select coalesce(jsonb_agg(e.id order by e.started_at,e.id),'[]'::jsonb) into episodes
 from public.notification_trial_episodes e join public.subscription_entitlements s on s.id=e.subscription_id and s.user_id=e.user_id
 where e.user_id=p_user_id and s.status='trialing' and s.provider='apple'
   and s.latest_transaction_id=e.transaction_id and s.environment=e.environment
   and s.trial_end=e.ends_at and s.current_period_end>at_time and e.ends_at>at_time
   and at_time>=e.started_at+interval '96 hours'
   and not exists (
     select 1
     from public.subscription_entitlements other
     where other.user_id=e.user_id
       and other.status in ('active','grace_period')
       and other.current_period_end>at_time
   )
   and exists (
     select 1
     from public.notification_preferences
     where user_id=p_user_id
       and notification_type='trial_ending'
       and enabled
   );
 return jsonb_build_object('allowed',true,'timezone',zone,'date',day,'dailyType',daily,'pillar',pillar,'trials',episodes);
end $$;
revoke all on function public.item03_notification_context(uuid) from public,anon,authenticated;
grant execute on function public.item03_notification_context(uuid) to service_role;

-- New entry point: do not rename/wrap an unknown installed claim implementation.
-- Existing RPC signatures and Item 02 identity/index remain intact for old callers.
create function public.claim_item03_notification(p_user_id uuid,p_type text,p_event_key text,p_pillar text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare ctx jsonb; day date; existing public.notification_delivery_claims%rowtype; reserved integer; legacy integer; claim_id uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 ctx:=public.item03_notification_context(p_user_id);
 if (ctx->>'allowed')::boolean is not true then return null; end if;
 day:=(ctx->>'date')::date;
 if not exists(select 1 from public.notification_preferences where user_id=p_user_id and notification_type=p_type and enabled) then return null; end if;
 if p_type in ('morning_checkin','lowest_pillar') then
   if ctx->>'dailyType' is distinct from p_type or p_event_key is distinct from 'daily:'||day::text
     or (p_type='lowest_pillar' and ctx->>'pillar' is distinct from p_pillar) then return null; end if;
   if exists(select 1 from public.notification_delivery_claims where user_id=p_user_id
     and type in ('morning_checkin','lowest_pillar') and local_day=day
     and (type<>p_type or event_key<>p_event_key)) then return null; end if;
 elsif p_type='trial_ending' then
   if p_event_key not like 'trial:%' or not (ctx->'trials' ? substring(p_event_key from 7)) then return null; end if;
 elsif p_type='weekly_score' then
   if p_event_key !~ '^weekly-report:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or not exists(select 1 from public.weekly_report_snapshots where user_id=p_user_id
       and reporting_week_start::text=substring(p_event_key from 15) and delivery_at<=clock_timestamp()) then return null; end if;
 elsif p_type='streak_at_risk' then return null;
 end if;
 if p_event_key is null or btrim(p_event_key)='' then return null; end if;
 select * into existing from public.notification_delivery_claims c where c.user_id=p_user_id and c.type=p_type and c.event_key=p_event_key
   and (c.local_day=day or p_type in ('weekly_score','trial_ending')) order by c.claimed_at limit 1;
 if found then
   if existing.completed_at is not null then return null; end if;
   if existing.local_day=day then return existing.id; end if;
 end if;
 select count(*) into reserved from public.notification_delivery_claims where user_id=p_user_id and local_day=day;
 select count(*) into legacy from public.notification_log where user_id=p_user_id and delivery_claim_id is null
   and public.scoring_date_at(p_user_id,sent_at)=day;
 if reserved+legacy>=3 then return null; end if;
 if existing.id is not null then
   update public.notification_delivery_claims set local_day=day where id=existing.id;
   return existing.id;
 end if;
 insert into public.notification_delivery_claims(user_id,type,local_day,event_key) values(p_user_id,p_type,day,p_event_key) returning id into claim_id;
 return claim_id;
end $$;
revoke all on function public.claim_item03_notification(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_item03_notification(uuid,text,text,text) to service_role;

-- Preserve the installed public signature while routing old callers through
-- the same canonical calendar, quiet hours, preferences and delivery caps.
-- The existing three-argument overload already delegates to this overload.
create or replace function public.claim_notification_delivery(
  p_user_id uuid,
  p_type text,
  p_timezone text,
  p_event_key text
)
returns uuid
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;

  -- p_timezone remains for caller compatibility.
  -- The shared policy obtains the canonical effective timezone itself.
  return public.claim_item03_notification(
    p_user_id,
    p_type,
    coalesce(nullif(btrim(p_event_key),''),'scheduled'),
    null
  );
end;
$$;

revoke all on function
  public.claim_notification_delivery(uuid,text,text,text)
from public,anon,authenticated,service_role;

grant execute on function
  public.claim_notification_delivery(uuid,text,text,text)
to service_role;
commit;
