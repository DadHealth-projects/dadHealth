begin;
-- Forward-only instrumentation. No changes to scoring or entitlement functions.
-- Suppression keys contain no event payload/timestamp and survive receipt expiry;
-- they prevent later consent/retries from inventing a lifetime first occurrence.
create table public.analytics_funnel_keys (
 user_id uuid not null references auth.users(id) on delete cascade,
 key text not null check(length(key)<=200), primary key(user_id,key)
);
create table public.analytics_return_cohorts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 consent_id uuid not null references public.analytics_consents(id) on delete cascade,
 completed_at timestamptz not null, timezone text not null, day_zero date not null
);
alter table public.analytics_funnel_keys enable row level security;
alter table public.analytics_return_cohorts enable row level security;
revoke all on public.analytics_funnel_keys,public.analytics_return_cohorts from public,anon,authenticated,service_role;

-- Serialize initial suppression against writes; never emit/backfill old history.
lock table public.mood_logs,public.workout_sessions,public.workout_completions,
 public.activity_logs,public.bond_logs,public.present_dad_sessions,public.user_profile,public.user_streaks in share row exclusive mode;
insert into public.analytics_funnel_keys
 select baseline.* from (select distinct user_id,'first_checkin' from public.mood_logs
 union select distinct user_id,'first_workout_logged' from public.workout_sessions
 union select distinct user_id,'first_workout_logged' from public.workout_completions
 union select distinct user_id,case pillar when 'body' then 'first_workout_logged' else 'first_bond_log' end from public.activity_logs where pillar in ('body','bond')
 union select distinct user_id,'first_bond_log' from public.bond_logs
 union select distinct user_id,'first_bond_log' from public.present_dad_sessions where status='completed' and completed_at is not null
 union select user_id,'onboarding_completed' from public.user_profile where jsonb_array_length(case when jsonb_typeof(goals)='array' then goals else '[]'::jsonb end)>0 and nullif(custody_pattern,'') is not null
 union select user_id,'onboarding_started' from public.user_profile where jsonb_array_length(case when jsonb_typeof(goals)='array' then goals else '[]'::jsonb end)>0 and nullif(custody_pattern,'') is not null
 union select user_id,'streak_reached:7' from public.user_streaks where streak_count>=7
 union select user_id,'streak_reached:14' from public.user_streaks where streak_count>=14
 ) baseline(user_id,key) where not exists(select 1 from public.account_deletion_tombstones t where t.user_id=baseline.user_id)
 on conflict do nothing;

-- Resolve ONLY the capability attached to the actual authenticated write.
-- Never choose the most recent consent belonging to an account/device.
create function public.analytics_write_scope(uid uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare h jsonb; c public.analytics_consents; cid uuid; secret text; digest text;
begin
 if auth.uid() is distinct from uid or coalesce(auth.role(),'')<>'authenticated' then return null; end if;
 h:=nullif(current_setting('request.headers',true),'')::jsonb;
 if h->>'x-dadhealth-analytics' is null or h->>'x-dadhealth-analytics'='none' then return null; end if;
 h:=(h->>'x-dadhealth-analytics')::jsonb;
 if h->>'owner' is distinct from uid::text then return null; end if;
 cid:=(h->>'consent')::uuid; secret:=h->>'secret';
 if cid is null or secret !~ '^[a-fA-F0-9-]{72}$' then return null; end if;
 digest:=encode(sha256(convert_to(secret,'UTF8')),'hex');
 -- Snapshot-only validation: no lock or lazy credential creation on a business save.
 if exists(select 1 from public.account_deletion_tombstones where user_id=uid) then return null; end if;
 select * into c from public.analytics_consents where id=cid;
 if not found or c.user_id is distinct from uid or c.secret_hash<>digest or c.revoked_at is not null or c.expires_at<=clock_timestamp() then return null; end if;
 return cid;
exception when lock_not_available or deadlock_detected then
 -- Roll back this optional trigger's work; the persisted business save survives.
 raise;
when others then
 raise log 'analytics scope suppressed [%]',sqlstate;
 return null;
end $$;


create function public.enqueue_analytics_fact(uid uuid,cid uuid,fact text,props jsonb,dedupe text,at_time timestamptz default clock_timestamp()) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.analytics_consents;
begin
 -- Private helper: trusted trigger/adapter supplies event and owner, never clients.
 perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||uid::text,0));
 if exists(select 1 from public.account_deletion_tombstones where user_id=uid) then return false; end if;
 insert into public.analytics_funnel_keys(user_id,key) values(uid,dedupe) on conflict do nothing;
 if not found or cid is null then return false; end if;
 select * into c from public.analytics_consents where id=cid and user_id=uid and revoked_at is null and expires_at>clock_timestamp();
 if not found or at_time<clock_timestamp()-interval '7 days' or at_time>clock_timestamp()+interval '1 minute' then return false; end if;
 if (select count(*) from public.analytics_outbox where consent_id=cid and state in ('pending','sending'))>=200 then return false; end if;
 insert into public.analytics_outbox(id,consent_id,user_id,distinct_id,event,occurred_at,properties)
 values(gen_random_uuid(),cid,uid,c.distinct_id,fact,at_time,props);
 return true;
end $$;

create function public.analytics_persisted_action() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid; fact text; cid uuid; n int; zone text; at_time timestamptz:=clock_timestamp(); old_timeout text;
begin
 uid:=new.user_id;
 old_timeout:=current_setting('lock_timeout');
 if tg_table_name='user_profile' then
  if jsonb_array_length(case when jsonb_typeof(new.goals)='array' then new.goals else '[]'::jsonb end)>0 and nullif(new.custody_pattern,'') is not null then
   if tg_op='UPDATE' and jsonb_array_length(case when jsonb_typeof(old.goals)='array' then old.goals else '[]'::jsonb end)>0 and nullif(old.custody_pattern,'') is not null then return new; end if;
   fact:='onboarding_completed';
  else return new; end if;
 elsif tg_table_name='streak_reconciliation_state' then
  if new.state<>'current' then return new; end if;
  select streak_count into n from public.user_streaks where user_id=uid;
 elsif tg_table_name='mood_logs' then fact:='first_checkin';
 elsif tg_table_name in ('workout_sessions','workout_completions') then fact:='first_workout_logged';
 elsif tg_table_name='present_dad_sessions' then
  if new.status<>'completed' or new.completed_at is null then return new; end if;
  if tg_op='UPDATE' and old.status='completed' then return new; end if;
  fact:='first_bond_log';
 elsif tg_table_name='bond_logs' then fact:='first_bond_log';
 elsif tg_table_name='activity_logs' then
  fact:=case new.pillar when 'body' then 'first_workout_logged' when 'bond' then 'first_bond_log' end;
 end if;
 if fact is not null and exists(select 1 from public.analytics_funnel_keys where user_id=uid and key=fact) then return new; end if;
 if fact is null and (n is null or n<7) then return new; end if;
 perform set_config('lock_timeout','100ms',true);
 cid:=public.analytics_write_scope(uid);
 -- If an earlier optional trigger failed, source history still prevents a
 -- later successful save being mislabelled first. At most two rows are read.
 if fact='first_checkin' and (select count(*) from (select 1 from public.mood_logs where user_id=uid limit 2) h)>1 then cid:=null;
 elsif fact='first_workout_logged' and (select count(*) from (
   select 1 from public.workout_sessions where user_id=uid
   union all select 1 from public.workout_completions where user_id=uid
   union all select 1 from public.activity_logs where user_id=uid and pillar='body' limit 2) h)>1 then cid:=null;
 elsif fact='first_bond_log' and (select count(*) from (
   select 1 from public.bond_logs where user_id=uid
   union all select 1 from public.activity_logs where user_id=uid and pillar='bond'
   union all select 1 from public.present_dad_sessions where user_id=uid and status='completed' and completed_at is not null limit 2) h)>1 then cid:=null;
 end if;
 if n is not null then
  if n>=7 then perform public.enqueue_analytics_fact(uid,cid,'streak_reached','{"milestone":7}','streak_reached:7',at_time); end if;
  if n>=14 then perform public.enqueue_analytics_fact(uid,cid,'streak_reached','{"milestone":14}','streak_reached:14',at_time); end if;
 elsif fact is not null then
  if public.enqueue_analytics_fact(uid,cid,fact,'{}',fact,at_time) and fact='onboarding_completed' then
   zone:=public.scoring_timezone_at(uid,at_time);
   insert into public.analytics_return_cohorts values(uid,cid,at_time,zone,(at_time at time zone zone)::date) on conflict do nothing;
  end if;
 end if;
 perform set_config('lock_timeout',old_timeout,true);
 return new;
exception when others then
 -- Analytics work rolls back independently; never reject a successful user save.
 perform set_config('lock_timeout',old_timeout,true);
 raise log 'analytics persisted action suppressed [%]',sqlstate;
 return new;
end $$;
create trigger analytics_checkin after insert on public.mood_logs for each row execute function public.analytics_persisted_action();
create trigger analytics_workout after insert on public.workout_sessions for each row execute function public.analytics_persisted_action();
create trigger analytics_workout_completion after insert on public.workout_completions for each row execute function public.analytics_persisted_action();
create trigger analytics_present_dad after insert or update on public.present_dad_sessions for each row execute function public.analytics_persisted_action();
create trigger analytics_bond after insert on public.bond_logs for each row execute function public.analytics_persisted_action();
create trigger analytics_manual_activity after insert on public.activity_logs for each row execute function public.analytics_persisted_action();
create trigger analytics_onboarding after insert or update of goals,custody_pattern on public.user_profile for each row execute function public.analytics_persisted_action();
create trigger analytics_streak after insert or update on public.streak_reconciliation_state for each row execute function public.analytics_persisted_action();

create function public.analytics_return_day(day_zero date,zone text,occurred timestamptz) returns int
language sql immutable strict set search_path=pg_catalog as $$select (occurred at time zone zone)::date-day_zero$$;
revoke all on function public.analytics_return_day(date,text,timestamptz) from public,anon,authenticated,service_role;

create function public.analytics_session_fact() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare cohort public.analytics_return_cohorts; day_number int;
begin
 if new.user_id is null then
  if new.event='onboarding_started' then return null; end if;
  return new;
 end if;
 if new.event='onboarding_started' then
  if exists(select 1 from public.user_profile where user_id=new.user_id and jsonb_array_length(case when jsonb_typeof(goals)='array' then goals else '[]'::jsonb end)>0 and nullif(custody_pattern,'') is not null) and not exists(select 1 from public.analytics_return_cohorts where user_id=new.user_id and completed_at>=new.occurred_at) then return null; end if;
  insert into public.analytics_funnel_keys values(new.user_id,'onboarding_started') on conflict do nothing;
  if not found then return null; end if;
 elsif new.event='app_opened' then
  select * into cohort from public.analytics_return_cohorts where user_id=new.user_id;
  if found and new.occurred_at>=cohort.completed_at then
   day_number:=public.analytics_return_day(cohort.day_zero,cohort.timezone,new.occurred_at);
   if day_number in (2,7,30) then
    perform public.enqueue_analytics_fact(new.user_id,new.consent_id,'return_day_reached',jsonb_build_object('day',day_number),'return_day_reached:'||day_number,new.occurred_at);
   end if;
  end if;
 end if;
 return new;
end $$;
create trigger analytics_session_fact before insert on public.analytics_outbox for each row execute function public.analytics_session_fact();

-- Withdrawal removes the optional calendar cohort, not lifetime suppression keys.
create function public.analytics_forget_cohort() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.revoked_at is not null then delete from public.analytics_return_cohorts where consent_id=new.id; end if;
 return new;
end $$;
create trigger analytics_forget_cohort after update of revoked_at on public.analytics_consents for each row execute function public.analytics_forget_cohort();
create function public.analytics_delete_funnel() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 delete from public.analytics_return_cohorts where user_id=new.user_id;
 delete from public.analytics_funnel_keys where user_id=new.user_id;
 return new;
end $$;
create trigger analytics_delete_funnel after insert on public.account_deletion_tombstones for each row execute function public.analytics_delete_funnel();

alter function public.account_export_dataset(uuid) rename to account_export_dataset_before_funnel;
create function public.account_export_dataset(p_user_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_set(jsonb_set(public.account_export_dataset_before_funnel(p_user_id),'{sections,analyticsSuppressionKeys}',
 coalesce((select jsonb_agg(key order by key) from public.analytics_funnel_keys where user_id=p_user_id),'[]')),
 '{sections,analyticsReturnCohort}',coalesce((select jsonb_agg(jsonb_build_object('completedAt',completed_at,'timezone',timezone,'dayZero',day_zero)) from public.analytics_return_cohorts where user_id=p_user_id),'[]'));
$$;
revoke all on function public.account_export_dataset(uuid),public.analytics_write_scope(uuid),
 public.enqueue_analytics_fact(uuid,uuid,text,jsonb,text,timestamptz),public.analytics_persisted_action(),
 public.analytics_session_fact(),public.analytics_forget_cohort(),public.analytics_delete_funnel() from public,anon,authenticated,service_role;
create or replace function public.cleanup_optional_analytics() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 delete from public.analytics_return_cohorts where completed_at<clock_timestamp()-interval '38 days';
 delete from public.analytics_outbox where (lease_until is null or lease_until<clock_timestamp()) and
 ((state<>'sent' and occurred_at<clock_timestamp()-interval '7 days') or created_at<clock_timestamp()-interval '30 days'
 or exists(select 1 from public.analytics_consents c where c.id=consent_id and c.revoked_at is not null));
 delete from public.analytics_rate_limits where window_at<clock_timestamp()-interval '1 day';
 -- Seven-day events cannot survive a 30-day revocation receipt. A new consent
 -- requires a fresh capability; old timestamps are rejected even after cleanup.
 delete from public.analytics_consents where id in (select c.id from public.analytics_consents c
 where ((c.revoked_at is null and c.expires_at<clock_timestamp()) or c.revoked_at<clock_timestamp()-interval '30 days')
 and not exists(select 1 from public.analytics_return_cohorts r where r.consent_id=c.id)
 and not exists(select 1 from public.analytics_outbox e where e.consent_id=c.id) for update skip locked);
end $$;



-- Trusted billing adapter only. Current callers suppress until applicable
-- background-billing consent is established. No grant to either client role.
create function public.record_verified_billing_analytics(p_owner uuid,p_consent uuid,p_hash text,p_provider text,p_environment text,
 p_subscription text,p_verified_at timestamptz,p_event text,p_key text,p_at timestamptz,p_properties jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_event not in ('trial_started','trial_converted','trial_cancelled','subscription_cancelled') or p_key !~ '^billing:[a-f0-9]{64}$' then return false; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||p_owner::text,0));
 perform pg_advisory_xact_lock(hashtextextended('analytics-consent:'||p_consent::text,0));
 if not exists(select 1 from public.analytics_consents where id=p_consent and user_id=p_owner and secret_hash=p_hash and revoked_at is null and expires_at>clock_timestamp()) then return false; end if;
 if not exists(select 1 from public.subscription_entitlements where user_id=p_owner and provider=p_provider and environment=p_environment
  and provider_subscription_id=p_subscription and last_verified_at=p_verified_at) then return false; end if;
 return public.enqueue_analytics_fact(p_owner,p_consent,p_event,p_properties,p_key,p_at);
end $$;
revoke all on function public.record_verified_billing_analytics(uuid,uuid,text,text,text,text,timestamptz,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.record_verified_billing_analytics(uuid,uuid,text,text,text,text,timestamptz,text,text,timestamptz,jsonb) to service_role;

commit;
