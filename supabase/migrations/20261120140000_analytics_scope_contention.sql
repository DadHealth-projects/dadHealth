begin;
-- Correct a first-action race without changing business locks/calculations.
create or replace function public.analytics_write_scope(uid uuid) returns uuid
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


-- Durable source receipts are committed with the business action, before the
-- best-effort enqueue subtransaction. No private content or raw capability secret.
create table public.analytics_action_recovery (
 id bigint generated always as identity primary key,
 event_id uuid not null default gen_random_uuid() unique,
 user_id uuid not null references auth.users(id) on delete cascade,
 fact text not null check(fact in ('first_checkin','first_workout_logged','first_bond_log','streak_reached','onboarding_completed')),
 dedupe text not null check(length(dedupe)<=64), properties jsonb not null check(jsonb_typeof(properties)='object' and octet_length(properties::text)<2048),
 consent_id uuid, occurred_at timestamptz not null, timezone text
);
create index analytics_recovery_owner on public.analytics_action_recovery(user_id,id);
alter table public.analytics_action_recovery enable row level security;
revoke all on public.analytics_action_recovery from public,anon,authenticated,service_role;

create function public.recover_analytics_actions(p_owner uuid default null) returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.analytics_action_recovery; c public.analytics_consents; n integer:=0; previous_timeout text:=current_setting('lock_timeout');
begin
 if coalesce(auth.role(),'')<>'service_role' and pg_trigger_depth()=0 then raise exception 'Forbidden' using errcode='42501'; end if;
 for r in select * from public.analytics_action_recovery where p_owner is null or user_id=p_owner order by id limit 100 loop
  begin
   perform set_config('lock_timeout','100ms',true);
   perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||r.user_id::text,0));
   perform pg_advisory_xact_lock(hashtextextended('analytics-fact:'||r.user_id::text||':'||r.dedupe,0));
   if r.consent_id is not null then perform pg_advisory_xact_lock(hashtextextended('analytics-consent:'||r.consent_id::text,0)); end if;
   if exists(select 1 from public.account_deletion_tombstones where user_id=r.user_id) then
    delete from public.analytics_action_recovery where user_id=r.user_id; continue;
   end if;
   -- Suppress even an unconsented original occurrence; a later save cannot replace it.
   insert into public.analytics_funnel_keys values(r.user_id,r.dedupe) on conflict do nothing;
   if found and r.consent_id is not null and r.occurred_at>clock_timestamp()-interval '7 days' then
    select * into c from public.analytics_consents where id=r.consent_id and user_id=r.user_id and revoked_at is null and r.occurred_at<expires_at;
    if found then
     insert into public.analytics_outbox(id,consent_id,user_id,distinct_id,event,occurred_at,properties)
     values(r.event_id,c.id,r.user_id,c.distinct_id,r.fact,r.occurred_at,r.properties) on conflict do nothing;
     if r.fact='onboarding_completed' then
      insert into public.analytics_return_cohorts values(r.user_id,c.id,r.occurred_at,r.timezone,(r.occurred_at at time zone r.timezone)::date) on conflict do nothing;
     end if;
     n:=n+1;
    end if;
   end if;
   delete from public.analytics_action_recovery where user_id=r.user_id and dedupe=r.dedupe;
  exception when others then
   -- This subtransaction rolls back keys/outbox, retaining the original receipt.
   raise log 'analytics recovery deferred [%]',sqlstate;
   if p_owner is not null then exit;end if;
  end;
 end loop;
 perform set_config('lock_timeout',previous_timeout,true);
 return n;
end $$;
revoke all on function public.recover_analytics_actions(uuid) from public,anon,authenticated;
grant execute on function public.recover_analytics_actions(uuid) to service_role;
create or replace function public.analytics_persisted_action() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
<<capture_action>>
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
 -- Capture consent without waiting for delivery/consent locks. The original
 -- receipt survives any later optional enqueue timeout or provider outage.
 cid:=public.analytics_write_scope(uid);
 if not exists(select 1 from public.analytics_action_recovery where user_id=uid and dedupe=capture_action.fact) then
 -- A missing receipt must never allow a later action to replace lost history.
 -- Existing recoverable receipts keep their original consent/time.
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
 end if;
 if n is not null then
  if n>=7 then insert into public.analytics_action_recovery(user_id,fact,dedupe,properties,consent_id,occurred_at) values(uid,'streak_reached','streak_reached:7','{"milestone":7}',cid,at_time); end if;
  if n>=14 then insert into public.analytics_action_recovery(user_id,fact,dedupe,properties,consent_id,occurred_at) values(uid,'streak_reached','streak_reached:14','{"milestone":14}',cid,at_time); end if;
 elsif fact is not null then
  zone:=case when fact='onboarding_completed' then public.scoring_timezone_at(uid,at_time) end;
  insert into public.analytics_action_recovery(user_id,fact,dedupe,properties,consent_id,occurred_at,timezone) values(uid,fact,fact,'{}',cid,at_time,zone);
 end if;
 perform public.recover_analytics_actions(uid);
 perform set_config('lock_timeout',old_timeout,true);
 return new;
exception when others then
 -- Analytics work rolls back independently; never reject a successful user save.
 perform set_config('lock_timeout',old_timeout,true);
 raise log 'analytics persisted action suppressed [%]',sqlstate;
 return new;
end $$;

create or replace function public.analytics_delete_funnel() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 delete from public.analytics_action_recovery where user_id=new.user_id;
 delete from public.analytics_return_cohorts where user_id=new.user_id;
 delete from public.analytics_funnel_keys where user_id=new.user_id;
 return new;
end $$;

-- Exposure evidence is not an event receipt. Keep it until remote reconciliation
-- completes; neither delivery flags nor 30-day event cleanup may erase it.
create table public.analytics_exposure (
 user_id uuid primary key, state text not null check(state in ('unknown','never','possible','erased')),
 first_handoff_at timestamptz
);
alter table public.analytics_exposure enable row level security;
revoke all on public.analytics_exposure from public,anon,authenticated,service_role;
insert into public.analytics_exposure(user_id,state) select id,'unknown' from auth.users;
create function public.analytics_new_owner() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 insert into public.analytics_exposure(user_id,state) values(new.id,'never') on conflict do nothing;
 return new;
exception when others then
 -- Missing evidence is conservatively unknown, never proof of no exposure.
 raise log 'analytics exposure initialization deferred [%]',sqlstate;
 return new;
end $$;
create trigger analytics_new_owner after insert on auth.users for each row execute function public.analytics_new_owner();
revoke all on function public.analytics_new_owner() from public,anon,authenticated,service_role;

create or replace function public.authorize_optional_analytics(p_id uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare e public.analytics_outbox;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into e from public.analytics_outbox where id=p_id;
 if not found then return false; end if;
 if e.user_id is not null then perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||e.user_id::text,0)); end if;
 perform pg_advisory_xact_lock(hashtextextended('analytics-consent:'||e.consent_id::text,0));
 if not exists(select 1 from public.analytics_outbox o join public.analytics_consents c on c.id=o.consent_id
 where o.id=p_id and o.lease=p_lease and o.state='sending' and o.lease_until>clock_timestamp()+interval '10 seconds'
 and c.revoked_at is null and o.occurred_at>clock_timestamp()-interval '7 days'
 and not exists(select 1 from public.account_deletion_tombstones t where t.user_id=o.user_id)) then return false; end if;
 if e.user_id is not null then
  insert into public.analytics_exposure(user_id,state,first_handoff_at) values(e.user_id,'possible',clock_timestamp())
  on conflict(user_id) do update set state='possible',first_handoff_at=coalesce(analytics_exposure.first_handoff_at,excluded.first_handoff_at);
 end if;
 -- The RPC transaction commits this evidence before HTTP can start.
 return true;
end $$;

create function public.prepare_analytics_erasure(p_owner uuid) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare exposure text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 if not public.purge_deleted_analytics(p_owner) then return 'draining'; end if;
 delete from public.analytics_action_recovery where user_id=p_owner;
 select state into exposure from public.analytics_exposure where user_id=p_owner;
 return case when exposure in ('never','erased') then 'clear' else 'required' end;
end $$;
create function public.confirm_analytics_erasure(p_owner uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('account-privacy:'||p_owner::text,0));
 if not exists(select 1 from public.account_deletion_tombstones where user_id=p_owner) then raise exception 'Deletion required';end if;
 insert into public.analytics_exposure(user_id,state) values(p_owner,'erased') on conflict(user_id) do update set state='erased';
end $$;
revoke all on function public.prepare_analytics_erasure(uuid),public.confirm_analytics_erasure(uuid) from public,anon,authenticated;
grant execute on function public.prepare_analytics_erasure(uuid),public.confirm_analytics_erasure(uuid) to service_role;
create function public.analytics_erasure_completed() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.kind='delete' and new.state='completed' then delete from public.analytics_exposure where user_id=new.user_id;end if;
 return new;
end $$;
create trigger analytics_erasure_completed after update of state on public.account_privacy_operations for each row execute function public.analytics_erasure_completed();
revoke all on function public.analytics_erasure_completed() from public,anon,authenticated,service_role;

alter function public.account_export_dataset(uuid) rename to account_export_dataset_before_recovery;
create function public.account_export_dataset(p_user_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
select jsonb_set(jsonb_set(public.account_export_dataset_before_recovery(p_user_id),'{sections,analyticsRecovery}',
coalesce((select jsonb_agg(jsonb_build_object('event',fact,'occurredAt',occurred_at,'properties',properties) order by id) from public.analytics_action_recovery where user_id=p_user_id),'[]')),
'{sections,analyticsExposure}',coalesce((select jsonb_agg(jsonb_build_object('state',state,'firstHandoffAt',first_handoff_at)) from public.analytics_exposure where user_id=p_user_id),'[]'));
$$;
revoke all on function public.account_export_dataset(uuid) from public,anon,authenticated,service_role;

-- Return the actual before/accepted pair under the canonical locks. Delegate
-- billing semantics and Apple cancellation evidence to the installed operation.
create function public.upsert_subscription_analytics_snapshot(p_snapshot jsonb,p_evidence jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid uuid:=(p_snapshot->>'p_user_id')::uuid; prior public.subscription_entitlements; accepted public.subscription_entitlements; result_id uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||uid::text,0));
 perform pg_advisory_xact_lock(hashtextextended('subscription:'||uid::text,0));
 select * into prior from public.subscription_entitlements where provider=p_snapshot->>'p_provider' and provider_subscription_id=p_snapshot->>'p_provider_subscription_id';
 result_id:=public.upsert_subscription_with_cancellation_evidence(p_snapshot,p_evidence);
 select * into strict accepted from public.subscription_entitlements where id=result_id;
 return jsonb_build_object('id',result_id,'previous',case when prior.id is null then null else to_jsonb(prior) end,'current',to_jsonb(accepted),
  'trialPeriod',(select jsonb_build_object('startedAt',started_at,'endsAt',ends_at) from public.subscription_trial_periods where subscription_id=result_id and user_id=uid));
end $$;
revoke all on function public.upsert_subscription_analytics_snapshot(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.upsert_subscription_analytics_snapshot(jsonb,jsonb) to service_role;
create or replace function public.cleanup_optional_analytics() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 insert into public.analytics_funnel_keys(user_id,key) select distinct user_id,dedupe from public.analytics_action_recovery where occurred_at<clock_timestamp()-interval '7 days' on conflict do nothing;
 delete from public.analytics_action_recovery where occurred_at<clock_timestamp()-interval '7 days';
 delete from public.analytics_return_cohorts where completed_at<clock_timestamp()-interval '38 days';
 delete from public.analytics_outbox where (lease_until is null or lease_until<clock_timestamp()) and
 ((state<>'sent' and occurred_at<clock_timestamp()-interval '7 days') or created_at<clock_timestamp()-interval '30 days'
 or exists(select 1 from public.analytics_consents c where c.id=consent_id and c.revoked_at is not null));
 delete from public.analytics_rate_limits where window_at<clock_timestamp()-interval '1 day';
 -- Removed capabilities cannot be recreated by ingestion or renewal.
 delete from public.analytics_consents where id in (select c.id from public.analytics_consents c
 where ((c.revoked_at is null and c.expires_at<clock_timestamp()) or c.revoked_at<clock_timestamp()-interval '30 days')
 and not exists(select 1 from public.analytics_return_cohorts r where r.consent_id=c.id)
 and not exists(select 1 from public.analytics_outbox e where e.consent_id=c.id) for update skip locked);
end $$;
commit;
