-- Milestone 3 notification rules (brief 01 and 03). Forward-only; replaces two
-- functions in place and widens one check constraint. No data is rewritten.
--  * Day-5 "trial ends in 2 days" notice: also for verified Google Play trials.
--  * Lowest-pillar nudge: only when the weakest pillar is below 40, or dropped
--    10+ points against the previous week. Quiet hours, one-nudge-per-day and
--    never-on-reminder-day rules are unchanged (they live in the callers).
-- Rollback: re-run the item03_inbox_context definition from
-- 20261117090000_notification_inbox.sql and record_notification_trial from
-- 20261116120000_item03_push_notifications.sql, then (only if no Google rows
-- exist) restore check(provider='apple') on notification_trial_episodes.
begin;

alter table public.notification_trial_episodes drop constraint if exists notification_trial_episodes_provider_check;
alter table public.notification_trial_episodes add constraint notification_trial_episodes_provider_check
  check (provider in ('apple','google'));

create or replace function public.record_notification_trial(p_subscription_id uuid,p_user_id uuid,
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

 if s.user_id is distinct from p_user_id or s.provider not in ('apple','google')
   or s.environment is distinct from p_environment then raise exception 'Trial owner mismatch' using errcode='42501'; end if;
 if s.status<>'trialing' or s.latest_transaction_id is distinct from p_transaction_id
   or s.trial_end is distinct from p_ends_at then return; end if;
 if p_transaction_id is null or p_started_at is null or p_ends_at is null
   or not isfinite(p_started_at) or not isfinite(p_ends_at)
   or p_started_at>=p_ends_at or p_started_at>clock_timestamp() then
   raise exception 'Invalid verified trial facts' using errcode='22023'; end if;
 insert into public.notification_trial_episodes(user_id,subscription_id,provider,environment,transaction_id,started_at,ends_at,verified_at)
 values(p_user_id,s.id,s.provider,p_environment,p_transaction_id,p_started_at,p_ends_at,clock_timestamp())
 on conflict(provider,environment,transaction_id) do nothing;
 if not exists(select 1 from public.notification_trial_episodes where user_id=p_user_id
   and subscription_id=s.id and provider=s.provider and environment=p_environment and transaction_id=p_transaction_id
   and started_at=p_started_at and ends_at=p_ends_at) then
   raise exception 'Conflicting trial facts' using errcode='22023'; end if;
end $$;
revoke all on function public.record_notification_trial(uuid,uuid,text,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.record_notification_trial(uuid,uuid,text,timestamptz,timestamptz,text) to service_role;

create or replace function public.item03_inbox_context(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare at_time timestamptz:=clock_timestamp(); zone text; day date; local_time time;
 scheduled time; daily text; pillar text; episodes jsonb; scores record;
 pillar_score numeric; pillar_change numeric;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;

 -- Require real calendar evidence: do not silently use the calendar helper's UTC fallback.
 zone:=public.scoring_timezone_at(p_user_id,at_time);
 if not exists(select 1 from public.scoring_timezone_history where user_id=p_user_id and effective_at<=at_time)
   and not exists(select 1 from public.user_profile p join pg_timezone_names z on z.name=p.timezone where p.user_id=p_user_id) then
   return jsonb_build_object('allowed',false); end if;
 if not exists(select 1 from pg_timezone_names where name=zone) then return jsonb_build_object('allowed',false); end if;
 day:=public.scoring_date_at(p_user_id,at_time);
 local_time:=(at_time at time zone zone)::time;

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
     daily:='morning_checkin';
   else
     select mind_score,body_score,bond_score,weakest_pillar,mind_week_change,body_week_change,bond_week_change
       into scores from public.dad_score_view where user_id=p_user_id;
     if scores.mind_score is not null and scores.body_score is not null and scores.bond_score is not null then
       pillar:=scores.weakest_pillar;
       -- Brief 03: nudge only when the weakest pillar is below 40, or fell 10+ points against last week.
       pillar_score:=case pillar when 'mind' then scores.mind_score when 'body' then scores.body_score when 'bond' then scores.bond_score end;
       pillar_change:=case pillar when 'mind' then scores.mind_week_change when 'body' then scores.body_week_change when 'bond' then scores.bond_week_change end;
       if pillar in ('mind','body','bond') and (pillar_score<40 or coalesce(pillar_change,0)<=-10) then daily:='lowest_pillar'; end if;
       if pillar='body' and not exists(select 1 from public.workouts where id='89e97b6c-0bfa-407d-a9f4-5020b086ba11'
         and source='admin' and access_level='free' and duration_mins=10) then daily:=null; end if;
     end if;
   end if;
 end if;
 select coalesce(jsonb_agg(e.id order by e.started_at,e.id),'[]'::jsonb) into episodes
 from public.notification_trial_episodes e join public.subscription_entitlements s on s.id=e.subscription_id and s.user_id=e.user_id
 where e.user_id=p_user_id and s.status='trialing' and s.provider in ('apple','google') and e.provider=s.provider
   and s.latest_transaction_id=e.transaction_id and s.environment=e.environment
   and s.trial_end=e.ends_at and s.current_period_end>at_time and e.ends_at>at_time
   and at_time>=e.started_at+interval '96 hours'
   and not exists (
     select 1
     from public.subscription_entitlements other
     where other.user_id=e.user_id
       and other.status in ('active','grace_period')
       and other.current_period_end>at_time
   );
 return jsonb_build_object('allowed',true,'timezone',zone,'date',day,'observedAt',at_time,'dailyType',daily,'pillar',pillar,'trials',episodes);
end $$;
revoke all on function public.item03_inbox_context(uuid) from public,anon,authenticated;
grant execute on function public.item03_inbox_context(uuid) to service_role;

commit;
