-- Item 03 Phase 2. Forward only; no historical delivery-log reconstruction.
begin;
do $$ begin
 if to_regprocedure('public.claim_item03_notification(uuid,text,text,text)') is null
 or to_regprocedure('public.scoring_date_at(uuid,timestamptz)') is null then
   raise exception 'Install Item 03 Phase 1 and canonical calendar prerequisites first';
 end if;
end $$;

-- An installation boundary, not an inferred account/trial/event timestamp.
do $$ begin
 execute format('create function public.notification_inbox_started_at() returns timestamptz language sql immutable set search_path=pg_catalog as %L',
   'select '||quote_literal(clock_timestamp())||'::timestamptz');
end $$;
revoke all on function public.notification_inbox_started_at() from public,anon,authenticated;
grant execute on function public.notification_inbox_started_at() to service_role;

create table public.notification_inbox_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 type text not null check(type in ('morning_checkin','lowest_pillar','trial_ending','bedtime_story','workout_window',
   'weekly_score','weekly_challenge','journal_prompt','milestone_anniversary','community_reply','community_like',
   'co_parent_event_added','present_dad_mode_complete','streak_at_risk')),
 source_key text not null check(length(source_key) between 1 and 200),
 title text not null check(length(title) between 1 and 250),
 description text not null check(length(description) between 1 and 2000),
 destination jsonb not null check ((
  jsonb_typeof(destination)='object'
  and destination->>'version'='1'
  and destination->>'type'=type
) is true),
 allocation_date date,
 created_at timestamptz not null,
 read_at timestamptz,
 unique(user_id,type,source_key),
 check((type in ('morning_checkin','lowest_pillar'))=(allocation_date is not null))
);
create unique index notification_inbox_daily on public.notification_inbox_events(user_id,allocation_date)
 where allocation_date is not null;
create index notification_inbox_page on public.notification_inbox_events(user_id,created_at desc,id desc);
create index notification_inbox_unread on public.notification_inbox_events(user_id) where read_at is null;
alter table public.notification_inbox_events enable row level security;
revoke all on public.notification_inbox_events from public,anon,authenticated,service_role;
grant select on public.notification_inbox_events to authenticated,service_role;
create policy notification_inbox_owner on public.notification_inbox_events for select to authenticated using(user_id=auth.uid());

create function public.guard_notification_inbox() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if (to_jsonb(new)-'read_at') is distinct from (to_jsonb(old)-'read_at')
   or (old.read_at is not null and new.read_at is distinct from old.read_at) then
   raise exception 'Inbox content is immutable' using errcode='42501';
 end if;
 return new;
end $$;
create trigger guard_notification_inbox before update on public.notification_inbox_events
 for each row execute function public.guard_notification_inbox();
revoke all on function public.guard_notification_inbox() from public,anon,authenticated,service_role;

create function public.ensure_notification_inbox_event(p_user_id uuid,p_type text,p_source_key text,
 p_title text,p_description text,p_destination jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare event public.notification_inbox_events%rowtype; day date; ctx jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_type='streak_at_risk' then return null; end if;
 if p_destination->>'type' is distinct from p_type or p_destination->>'version' is distinct from '1'
   or p_destination->>'link' is null or p_destination->>'link' not in ('/','/bond','/fitness','/progress','/mind','/community') then
   raise exception 'Invalid inbox destination' using errcode='22023'; end if;
 if (p_type in ('morning_checkin','lowest_pillar','trial_ending') and p_destination->>'destination_version' is distinct from '1')
   or (p_type='lowest_pillar' and coalesce(p_destination->>'pillar','') not in ('mind','body','bond'))
   or (p_type='lowest_pillar' and p_destination->>'pillar'='body' and p_destination->>'workout_id' is distinct from '89e97b6c-0bfa-407d-a9f4-5020b086ba11')
   or (p_type='trial_ending' and coalesce(p_destination->>'trial_episode','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
   or (p_type='weekly_score' and (coalesce(p_destination->>'reporting_week','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or extract(isodow from (p_destination->>'reporting_week')::date)<>1))
   or (p_type in ('community_reply','community_like') and coalesce(p_destination->>'post_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
   or (p_type='co_parent_event_added' and coalesce(p_destination->>'event_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then
   raise exception 'Invalid typed inbox destination' using errcode='22023'; end if;
 -- Same single owner lock as Phase 1 claims; no inverse lock ordering.
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 if p_type in ('morning_checkin','lowest_pillar') then
   day:=public.scoring_date_at(p_user_id,clock_timestamp());
   if p_source_key is distinct from 'daily:'||day::text then return null; end if;
   select * into event from public.notification_inbox_events where user_id=p_user_id and allocation_date=day;
 else
   select * into event from public.notification_inbox_events where user_id=p_user_id and type=p_type and source_key=p_source_key;
 end if;
 if found then return to_jsonb(event); end if;
 if day is not null then
   ctx:=public.item03_inbox_context(p_user_id);
   if ctx->>'dailyType' is distinct from p_type
     or (p_type='lowest_pillar' and ctx->>'pillar' is distinct from p_destination->>'pillar') then return null; end if;
 end if;
 insert into public.notification_inbox_events(user_id,type,source_key,title,description,destination,allocation_date,created_at)
 values(p_user_id,p_type,p_source_key,p_title,p_description,p_destination,day,clock_timestamp()) returning * into event;
 return to_jsonb(event);
end $$;
revoke all on function public.ensure_notification_inbox_event(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.ensure_notification_inbox_event(uuid,text,text,text,text,jsonb) to service_role;

-- One owner-authenticated read/write interface, called with the user's JWT.
create function public.notification_inbox(p_action text default 'list',p_id uuid default null,
 p_before_at timestamptz default null,p_before_id uuid default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare owner uuid:=auth.uid(); at_time timestamptz; rows jsonb; total integer; event jsonb; today date;
begin
 if owner is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_action is null
  or p_action not in ('list','get','read','read_all','count')
  or p_limit is null
  or p_limit not between 1 and 50
  or ((p_before_at is null)<>(p_before_id is null))
  or (p_before_at is not null and not isfinite(p_before_at))
  or (p_action in ('get','read') and p_id is null)
then
  raise exception 'Invalid inbox request' using errcode='22023';
end if;
 if p_action in ('read','read_all') then
   perform pg_advisory_xact_lock(hashtextextended(owner::text,0));
   at_time:=clock_timestamp();
   if p_action='read' and not exists(select 1 from public.notification_inbox_events where id=p_id and user_id=owner) then
     raise exception 'Update unavailable' using errcode='P0002'; end if;
   update public.notification_inbox_events set read_at=at_time
   where user_id=owner and read_at is null and created_at<=at_time and (p_action='read_all' or id=p_id);
 end if;
 at_time:=coalesce(at_time,clock_timestamp()); today:=public.scoring_date_at(owner,at_time);
 -- Page and total come from the same statement snapshot. No offset pagination.
 with page as (
   select e.*,case when public.scoring_date_at(owner,e.created_at)=today then 'Today'
     when public.scoring_date_at(owner,e.created_at)=today-1 then 'Yesterday' else 'Earlier' end as day_group
   from public.notification_inbox_events e where e.user_id=owner
     and (p_before_at is null or (e.created_at,e.id)<(p_before_at,p_before_id))
   order by e.created_at desc,e.id desc limit p_limit
 ) select coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id desc) from page),'[]'::jsonb),
   (select count(*) from public.notification_inbox_events where user_id=owner and read_at is null),
   (select to_jsonb(e) from public.notification_inbox_events e where user_id=owner and id=p_id)
 into rows,total,event;
 return jsonb_build_object('items',case when p_action='list' then rows else '[]'::jsonb end,
   'unreadCount',total,'event',event,'cutoff',at_time,'timezone',public.scoring_timezone_at(owner,at_time),'today',today);
end $$;
revoke all on function public.notification_inbox(text,uuid,timestamptz,uuid,integer) from public,anon,service_role;
grant execute on function public.notification_inbox(text,uuid,timestamptz,uuid,integer) to authenticated;

-- Source eligibility deliberately excludes push consent, quiet hours and rollout.
create function public.item03_inbox_context(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare at_time timestamptz:=clock_timestamp(); zone text; day date; local_time time;
 scheduled time; daily text; pillar text; episodes jsonb; scores record;
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
   );
 return jsonb_build_object('allowed',true,'timezone',zone,'date',day,'observedAt',at_time,'dailyType',daily,'pillar',pillar,'trials',episodes);
end $$;
revoke all on function public.item03_inbox_context(uuid) from public,anon,authenticated;
grant execute on function public.item03_inbox_context(uuid) to service_role;

-- Preserve the callable Phase 1 policy; only the durable daily winner may send.
create or replace function public.item03_notification_context(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare ctx jsonb; local_time time; winner public.notification_inbox_events%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 ctx:=public.item03_inbox_context(p_user_id);
 if ctx->>'allowed' is distinct from 'true' then return ctx; end if;
 if not exists(select 1 from public.user_profile where user_id=p_user_id and push_notifications_enabled) then
   return jsonb_build_object('allowed',false); end if;
 local_time:=(clock_timestamp() at time zone (ctx->>'timezone'))::time;
 if local_time<time '08:00' or local_time>=time '21:00' then return jsonb_build_object('allowed',false); end if;
 select * into winner from public.notification_inbox_events where user_id=p_user_id and allocation_date=(ctx->>'date')::date;
 if found and (winner.type is distinct from ctx->>'dailyType'
   or (winner.type='lowest_pillar' and winner.destination->>'pillar' is distinct from ctx->>'pillar')) then
   ctx:=jsonb_set(ctx,'{dailyType}','null'::jsonb);
 end if;
 if not exists(select 1 from public.notification_preferences where user_id=p_user_id and notification_type=ctx->>'dailyType' and enabled) then
   ctx:=jsonb_set(ctx,'{dailyType}','null'::jsonb); end if;
 if not exists(select 1 from public.notification_preferences where user_id=p_user_id and notification_type='trial_ending' and enabled) then
   ctx:=jsonb_set(ctx,'{trials}','[]'::jsonb); end if;
 return ctx;
end $$;
revoke all on function public.item03_notification_context(uuid) from public,anon,authenticated;
grant execute on function public.item03_notification_context(uuid) to service_role;

-- Retry discovery from authoritative source rows, never delivery logs. Recipient
-- and privacy eligibility are rechecked by the existing event handler.
-- Calendar events previously carried the actor only in an ephemeral webhook.
-- Preserve the accepted insert actor prospectively so retries exclude the same
-- participant; never infer/backfill historical authors or trust a client value.
alter table public.co_parenting_events add column notification_actor_user_id uuid;
create function public.stamp_notification_calendar_actor() returns trigger
language plpgsql set search_path=pg_catalog,public as $$ begin
 new.notification_actor_user_id:=case when tg_op='INSERT' then auth.uid() else old.notification_actor_user_id end;
 return new;
end $$;
create trigger stamp_notification_calendar_actor before insert or update on public.co_parenting_events
 for each row execute function public.stamp_notification_calendar_actor();
revoke all on function public.stamp_notification_calendar_actor() from public,anon,authenticated,service_role;
create function public.notification_inbox_retry_sources()
returns table(type text,record_id uuid,actor_user_id uuid,target_type text)
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 return query
 with sources as (
  select 'community_reply'::text kind,c.id record,c.user_id actor,null::text target,c.created_at at_time,
    c.post_id,recipient.owner,c.id::text source
  from public.comments c join public.posts p on p.id=c.post_id
  left join public.anonymous_post_owners a on a.post_id=p.id
  left join public.comments parent on parent.id=c.parent_id
  cross join lateral (select coalesce(p.user_id,a.user_id) owner union select parent.user_id) recipient
  union all
  select 'community_like',l.post_id,l.user_id,'post',l.created_at,l.post_id,coalesce(p.user_id,a.user_id),
    'post:'||l.post_id||':'||l.user_id
  from public.likes l join public.posts p on p.id=l.post_id left join public.anonymous_post_owners a on a.post_id=p.id
  union all
  select 'community_like',l.comment_id,l.user_id,'comment',l.created_at,c.post_id,c.user_id,
    'comment:'||l.comment_id||':'||l.user_id
  from public.comment_likes l join public.comments c on c.id=l.comment_id
  union all
  select 'co_parent_event_added',e.id,e.notification_actor_user_id,null::text,e.created_at,null::uuid,recipient.owner,e.id::text
  from public.co_parenting_events e join public.co_parenting_schedules s on s.id=e.schedule_id
  cross join lateral (select s.user_id owner union select s.co_parent_user_id) recipient
 ) select distinct x.kind,x.record,x.actor,x.target from sources x
 where x.at_time>=public.notification_inbox_started_at() and x.owner is not null
   and (x.actor is null or x.owner<>x.actor)
   and (x.post_id is null or not exists(select 1 from public.posts p join public.circles c on c.id=p.circle_id
     where p.id=x.post_id and c.visibility='private'
       and not exists(select 1 from public.user_circles m where m.circle_id=c.id and m.user_id=x.owner)))
   and not exists(select 1 from public.notification_inbox_events i where i.user_id=x.owner and i.type=x.kind and i.source_key=x.source)
 limit 100;
end $$;
revoke all on function public.notification_inbox_retry_sources() from public,anon,authenticated;
grant execute on function public.notification_inbox_retry_sources() to service_role;
commit;
