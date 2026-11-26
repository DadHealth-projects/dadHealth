-- Timezone validity without scanning pg_timezone_names on every call.
--
-- Evidence (production, read-only, 26 Nov 2026): one lookup in pg_timezone_names takes 551 ms on
-- the Nano compute (it opens and parses ~1,200 timezone files each time). scoring_timezone_at
-- uses it as the fallback for every profile without timezone history (8 of 11), and
-- item03_inbox_context uses it on every call for every member. Those two sit under Mind Plan,
-- notifications, streaks, weekly reports, scoring and Mind Reset; item03_inbox_context alone was
-- 27.6% of all database execution time since the 25 Nov restart (3,228 calls, 308 ms average).
--
-- Change: the names are copied once into an indexed table; public.is_known_timezone(name)
-- checks it first and only falls back to pg_timezone_names for a name not in the copy (invalid
-- input, or a zone added by a later server timezone update), so the answer is unchanged for
-- every input. The three functions below are copied verbatim from production with only their
-- pg_timezone_names lookups replaced. Signatures, owners, grants, security definer and
-- search_path are unchanged (create or replace keeps grants and the user_profile trigger).
-- Rollback: section 5 of sql_editor_steps/11_timezone_lookup_cache.sql (restores the three
-- production definitions verbatim, then drops the helper and table).

create table if not exists public.scoring_timezone_names (name text primary key);
alter table public.scoring_timezone_names enable row level security;
revoke all on table public.scoring_timezone_names from public, anon, authenticated;
insert into public.scoring_timezone_names(name)
select name from pg_catalog.pg_timezone_names on conflict (name) do nothing;
comment on table public.scoring_timezone_names is
  'Copy of pg_timezone_names for fast validity checks. Server-only. Refresh after a Postgres timezone-data update: insert into public.scoring_timezone_names select name from pg_timezone_names on conflict do nothing;';

create or replace function public.is_known_timezone(p_name text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog, public
as $function$
begin
  if p_name is null then return false; end if;
  if exists (select 1 from public.scoring_timezone_names where name = p_name) then return true; end if;
  -- Not in the copy: invalid input, or a zone added after the copy was made. Same answer as before.
  return exists (select 1 from pg_catalog.pg_timezone_names where name = p_name);
end;
$function$;
revoke all on function public.is_known_timezone(text) from public, anon, authenticated;
grant execute on function public.is_known_timezone(text) to service_role;

-- scoring_timezone_at: verbatim from 20261111120000_mind_participation_and_scoring_calendar.sql (identical to production, md5 checked 26 Nov 2026),
-- with only the pg_timezone_names lookups replaced by public.is_known_timezone().
create or replace function public.scoring_timezone_at(p_user_id uuid, p_at timestamptz)
returns text language sql stable security definer set search_path = pg_catalog, public
as $function$
  select coalesce(
    (select h.timezone from public.scoring_timezone_history h where h.user_id = p_user_id and h.effective_at <= p_at order by h.effective_at desc limit 1),
    (select p.timezone from public.user_profile p where p.user_id = p_user_id and public.is_known_timezone(p.timezone)),
    'UTC');
$function$;

-- capture_scoring_timezone: verbatim from 20261111120000_mind_participation_and_scoring_calendar.sql (identical to production, md5 checked 26 Nov 2026),
-- with only the pg_timezone_names lookups replaced by public.is_known_timezone().
create or replace function public.capture_scoring_timezone()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare old_zone text; new_zone text; next_week date;
begin
  new_zone := coalesce(nullif(new.timezone, ''), 'UTC');
  if not public.is_known_timezone(new_zone) then
    raise exception using errcode = '22023', message = 'invalid_scoring_timezone';
  end if;
  if tg_op = 'INSERT' then
    insert into public.scoring_timezone_history values (new.user_id, '-infinity', '-infinity', new_zone) on conflict do nothing;
  elsif new.timezone is distinct from old.timezone then
    select h.timezone into old_zone from public.scoring_timezone_history h where h.user_id=old.user_id and h.effective_at<=now() order by h.effective_at desc limit 1;
    old_zone := coalesce(old_zone,(case when public.is_known_timezone(old.timezone) then old.timezone end),'UTC');
    insert into public.scoring_timezone_history values (old.user_id, '-infinity', '-infinity', old_zone) on conflict do nothing;
    -- Pending westward changes may still be in Sunday despite the old clock
    -- reading Monday. Do not skip the pending scoring week when editing again.
    next_week := date_trunc('week', least((now() at time zone old_zone)::date,
      coalesce((select min(effective_week_start)-1 from public.scoring_timezone_history
        where user_id=old.user_id and effective_at>now()), 'infinity'::date)))::date + 7;
    if next_week::timestamp at time zone new_zone <= now() then next_week := next_week + 7; end if;
    -- Replace only unactivated requests; keep all effective history immutable.
    delete from public.scoring_timezone_history where user_id=old.user_id and effective_at>now();
    insert into public.scoring_timezone_history values (old.user_id, next_week, next_week::timestamp at time zone new_zone, new_zone)
      on conflict (user_id,effective_week_start) do update set timezone=excluded.timezone, effective_at=excluded.effective_at;
  end if;
  return new;
end;
$function$;

-- item03_inbox_context: verbatim from 20261125100000_m3_notification_rules.sql (identical to production, md5 checked 26 Nov 2026),
-- with only the pg_timezone_names lookups replaced by public.is_known_timezone().
create or replace function public.item03_inbox_context(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare at_time timestamptz:=clock_timestamp(); zone text; day date; local_time time;
 scheduled time; daily text; pillar text; episodes jsonb; scores record;
 pillar_score numeric; pillar_change numeric;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;

 -- Require real calendar evidence: do not silently use the calendar helper's UTC fallback.
 zone:=public.scoring_timezone_at(p_user_id,at_time);
 if not exists(select 1 from public.scoring_timezone_history where user_id=p_user_id and effective_at<=at_time)
   and not exists(select 1 from public.user_profile p where p.user_id=p_user_id and public.is_known_timezone(p.timezone)) then
   return jsonb_build_object('allowed',false); end if;
 if not public.is_known_timezone(zone) then return jsonb_build_object('allowed',false); end if;
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
end $function$;
