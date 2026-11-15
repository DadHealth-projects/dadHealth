-- Phase C only. No scheduler, scoring changes, or subscription access changes.
-- Apply in one transaction. Source locks make activation/evidence seeding atomic.
begin;
lock table public.user_profile, public.subscription_entitlements, public.mood_logs,
  public.user_streaks, public.user_streak_freezes in share row exclusive mode;

create table if not exists public.streak_reconciliation_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  activation_at timestamptz not null,
  start_date date not null,
  evidence_from timestamptz not null,
  baseline_count integer not null check (baseline_count >= 0),
  baseline_last_date date,
  baseline_closed boolean not null default false,
  reconciled_through date,
  observed_at timestamptz,
  state text not null default 'scheduled' check (state in ('scheduled','current','pending')),
  pending_date date,
  check (activation_at >= evidence_from)
);
create table if not exists public.streak_checkin_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  checkin_date date not null,
  received_at timestamptz not null,
  activation_pending boolean not null default false,
  primary key (user_id, checkin_date)
);
alter table public.streak_checkin_receipts add column if not exists activation_pending boolean not null default false;
-- Facts, not a competing subscription ledger: one source is a manual grant or
-- an existing entitlement row. Expiry is evaluated at the missed-day boundary.
create table if not exists public.streak_access_evidence (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  recorded_at timestamptz not null,
  grants_access boolean not null,
  expires_at timestamptz,
  check (source_key = 'manual' or source_key like 'entitlement:%')
);
create index if not exists streak_access_evidence_lookup
  on public.streak_access_evidence(user_id, source_key, recorded_at desc, id desc);
alter table public.streak_reconciliation_state enable row level security;
alter table public.streak_checkin_receipts enable row level security;
alter table public.streak_access_evidence enable row level security;
revoke all on public.streak_reconciliation_state, public.streak_checkin_receipts,
  public.streak_access_evidence from public, anon, authenticated, service_role;

-- Resolve a date's exclusive end through the established scoring calendar.
-- Sunday ends at the next canonical Monday, including east/west zone changes.
create or replace function public.streak_day_end(uid uuid, day date)
returns timestamptz language sql stable security definer
set search_path = pg_catalog, public as $$
  select case when extract(isodow from day)=7 then public.scoring_week_boundary(uid,day+1)
    else (day+1)::timestamp at time zone public.scoring_timezone_at(uid,
      public.scoring_week_boundary(uid,date_trunc('week',day)::date)) end;
$$;

-- Only the migration owner can call setup with a supplied time. Runtime callers
-- use clock_timestamp(). Existing state is never re-seeded on migration reapply.
create or replace function public.initialize_checkin_streak(uid uuid, observed timestamptz)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare today date; seeded integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('streak:'||uid::text,0));
  if exists(select 1 from public.streak_reconciliation_state where user_id=uid) then return; end if;
  today:=public.scoring_date_at(uid,observed);
  insert into public.streak_reconciliation_state(user_id,activation_at,start_date,evidence_from,baseline_count,baseline_last_date)
    select uid,public.streak_day_end(uid,today),today+1,observed,
      coalesce(s.streak_count,0),s.last_activity_date
    from public.user_profile p left join public.user_streaks s on s.user_id=p.user_id where p.user_id=uid;
  get diagnostics seeded = row_count;
  if seeded=0 then return; end if;
  insert into public.streak_access_evidence(user_id,source_key,recorded_at,grants_access,expires_at)
    select uid,'manual',observed,coalesce(manual_pro_grant,false),null from public.user_profile where user_id=uid;
  insert into public.streak_access_evidence(user_id,source_key,recorded_at,grants_access,expires_at)
    select uid,'entitlement:'||id::text,observed,
      status in ('active','trialing','grace_period') and current_period_end is not null,current_period_end
    from public.subscription_entitlements where user_id=uid;
  -- Existing future/check-in rows receive an honest setup observation, not a
  -- fabricated historical receipt. Pre-activation rows never drive replay.
  insert into public.streak_checkin_receipts(user_id,checkin_date,received_at) select uid,date,observed from public.mood_logs where user_id=uid
    on conflict do nothing;
end;
$$;

-- Evidence triggers only append NEW/OLD facts. They do not acquire streak or
-- subscription locks, read other providers, or update canonical access rows.
create or replace function public.record_streak_access_evidence()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare at_time timestamptz:=clock_timestamp();
begin
  if tg_table_name='user_profile' then
    if tg_op='DELETE' then
      if exists(select 1 from auth.users where id=old.user_id) then
        insert into public.streak_access_evidence(user_id,source_key,recorded_at,grants_access)
          values(old.user_id,'manual',at_time,false);
      end if;
    elsif tg_op='INSERT' then
      perform public.initialize_checkin_streak(new.user_id,at_time);
    elsif new.manual_pro_grant is distinct from old.manual_pro_grant then
      insert into public.streak_access_evidence(user_id,source_key,recorded_at,grants_access)
        values(new.user_id,'manual',at_time,coalesce(new.manual_pro_grant,false));
    end if;
  else
    if tg_op='UPDATE' and new.user_id=old.user_id and new.status=old.status
      and new.current_period_end is not distinct from old.current_period_end then return new; end if;
    if tg_op='DELETE' or (tg_op='UPDATE' and old.user_id is distinct from new.user_id) then
      -- Account-deletion cascades must not reinsert an orphaned evidence row.
      if exists(select 1 from auth.users where id=old.user_id) then
        insert into public.streak_access_evidence(user_id,source_key,recorded_at,grants_access)
          values(old.user_id,'entitlement:'||old.id::text,at_time,false);
      end if;
    end if;
    if tg_op<>'DELETE' then
      insert into public.streak_access_evidence(user_id,source_key,recorded_at,grants_access,expires_at)
        values(new.user_id,'entitlement:'||new.id::text,at_time,
          new.status in ('active','trialing','grace_period') and new.current_period_end is not null,new.current_period_end);
    end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create or replace function public.streak_access_at(uid uuid, boundary timestamptz)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select case when not exists(select 1 from public.streak_reconciliation_state
      where user_id=uid and evidence_from<=boundary)
    or not exists(select 1 from public.streak_access_evidence
      where user_id=uid and source_key='manual' and recorded_at<=boundary) then null
  else coalesce((select bool_or(grants_access and (source_key='manual' or expires_at>boundary))
    from (select distinct on (source_key) source_key,grants_access,expires_at
      from public.streak_access_evidence where user_id=uid and recorded_at<=boundary
      order by source_key,recorded_at desc,id desc) facts),false) end;
$$;

-- Pure replay under one statement snapshot; no writes or locks here. Replaying
-- the prospective range supports deletions even after the 48-hour insert window.
create or replace function public.build_checkin_streak(uid uuid, observed timestamptz)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare s public.streak_reconciliation_state%rowtype; day date; today date; ending timestamptz;
  n integer; last_day date; through_day date; protected date[]; week date; eligible boolean;
begin
  select * into s from public.streak_reconciliation_state where user_id=uid;
  if not found then return jsonb_build_object('state','pending','reason','activation_missing'); end if;
  n:=s.baseline_count; last_day:=s.baseline_last_date;
  select coalesce(array_agg(missed_date order by missed_date),'{}'::date[]) into protected
    from public.user_streak_freezes where user_id=uid and missed_date<s.start_date;
  if observed<s.activation_at then
    return jsonb_build_object('state','scheduled','count',n,'lastDate',last_day,'through',null,'protected',protected);
  end if;
  if last_day>=s.start_date then
    return jsonb_build_object('state','pending','reason','baseline_date_conflict','count',n,
      'lastDate',last_day,'through',null,'protected',protected,'pendingDate',s.start_date);
  end if;
  today:=public.scoring_date_at(uid,observed);
  through_day:=s.start_date-1;
  for day in select generate_series(s.start_date::timestamp,today::timestamp,interval '1 day')::date loop
    ending:=public.streak_day_end(uid,day);
    if exists(select 1 from public.mood_logs m join public.streak_checkin_receipts r
      on r.user_id=m.user_id and r.checkin_date=m.date
      where m.user_id=uid and m.date=day and r.received_at<=observed
        and r.received_at<=ending+interval '48 hours') then
      n:=n+1; last_day:=day;
    elsif ending<=observed then
      eligible:=public.streak_access_at(uid,ending);
      if eligible is null then
        return jsonb_build_object('state','pending','reason','eligibility_unknown','count',n,
          'lastDate',last_day,'through',through_day,'protected',protected,'pendingDate',day);
      end if;
      week:=date_trunc('week',day)::date;
      if n>0 and eligible and not exists(select 1 from unnest(protected) d where d>=week and d<week+7) then
        protected:=array_append(protected,day);
      else n:=0; end if;
    end if;
    if ending<=observed then through_day:=day; end if;
  end loop;
  return jsonb_build_object('state','current','count',n,'lastDate',last_day,'through',through_day,'protected',protected);
end;
$$;

-- Owner-only worker accepts a time for deterministic isolated tests. It has NO
-- client/service-role grants. Production entry points always supply server time.
create or replace function public.apply_checkin_streak(uid uuid, observed timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare s public.streak_reconciliation_state%rowtype; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('streak:'||uid::text,0));
  select * into s from public.streak_reconciliation_state where user_id=uid for update;
  if not found then return jsonb_build_object('state','pending','reason','activation_missing'); end if;
  result:=public.build_checkin_streak(uid,observed);
  if result->>'state'='scheduled' then return result; end if;
  -- Unknown results do not overwrite established outputs or consume protection.
  if result->>'state'='current' then
    delete from public.user_streak_freezes where user_id=uid and missed_date>=s.start_date
      and not exists(select 1 from jsonb_array_elements_text(result->'protected') d where d::date=missed_date);
    insert into public.user_streak_freezes(user_id,week_start,missed_date)
      select uid,date_trunc('week',d::date)::date,d::date
      from jsonb_array_elements_text(result->'protected') d where d::date>=s.start_date
      on conflict(user_id,week_start) do nothing;
    insert into public.user_streaks(user_id,streak_count,last_activity_date,updated_at)
      values(uid,(result->>'count')::integer,(result->>'lastDate')::date,clock_timestamp())
      on conflict(user_id) do update set streak_count=excluded.streak_count,
        last_activity_date=excluded.last_activity_date,updated_at=excluded.updated_at;
  end if;
  update public.streak_reconciliation_state set baseline_closed=true,state=result->>'state',
    pending_date=(result->>'pendingDate')::date,reconciled_through=(result->>'through')::date,observed_at=observed
    where user_id=uid;
  return result;
end;
$$;

-- Retain the installed pre-activation writer unchanged, privately. This preserves
-- setup-to-boundary writes without running a retrospective historical rebuild.
do $$ begin
  if to_regprocedure('public.record_streak_activity_before_phase_c(uuid,date)') is null then
    alter function public.record_streak_activity(uuid,date) rename to record_streak_activity_before_phase_c;
  end if;
end $$;
revoke all on function public.record_streak_activity_before_phase_c(uuid,date) from public,anon,authenticated,service_role;

create or replace function public.record_streak_activity(p_user_id uuid,p_activity_date date)
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.streak_reconciliation_state%rowtype; observed timestamptz; n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('streak:'||p_user_id::text,0));
  observed:=clock_timestamp();
  select * into s from public.streak_reconciliation_state where user_id=p_user_id for update;
  if not found then return null; end if;
  -- A check-in received BEFORE activation can wait on this lock until AFTER
  -- activation. Finish that accepted legacy write against the opening baseline,
  -- then replay prospective days. Never use the already-reconciled output as
  -- its baseline, and never admit a newly received pre-activation repair.
  if observed>=s.activation_at and p_activity_date<s.start_date
    and (s.baseline_last_date is null or p_activity_date>s.baseline_last_date)
    and exists(select 1 from public.mood_logs m join public.streak_checkin_receipts r
      on r.user_id=m.user_id and r.checkin_date=m.date
      where m.user_id=p_user_id and m.date=p_activity_date and r.received_at<s.activation_at and r.activation_pending) then
    insert into public.user_streaks(user_id,streak_count,last_activity_date)
      values(p_user_id,s.baseline_count,s.baseline_last_date)
      on conflict(user_id) do update set streak_count=excluded.streak_count,last_activity_date=excluded.last_activity_date;
    perform public.record_streak_activity_before_phase_c(p_user_id,p_activity_date);
    update public.streak_reconciliation_state a set baseline_count=coalesce(b.streak_count,0),baseline_last_date=b.last_activity_date
      from public.user_streaks b where a.user_id=p_user_id and b.user_id=a.user_id;
  end if;
  if observed<s.activation_at then
    if exists(select 1 from public.mood_logs where user_id=p_user_id and date=p_activity_date) then
      perform public.record_streak_activity_before_phase_c(p_user_id,p_activity_date);
    end if;
    update public.streak_reconciliation_state a set baseline_count=coalesce(b.streak_count,0),baseline_last_date=b.last_activity_date
      from public.user_streaks b where a.user_id=p_user_id and b.user_id=a.user_id;
  else
    perform public.apply_checkin_streak(p_user_id,observed);
  end if;
  select streak_count into n from public.user_streaks where user_id=p_user_id;
  return n;
end;
$$;

-- Capture receipt BEFORE the streak lock. Never trust mood_logs.created_at or
-- offline client timestamps. Receipt/source row locks precede the AFTER trigger's
-- streak lock. Reconciliation never locks or writes either source/receipt rows.
create or replace function public.stamp_streak_checkin_receipt()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare received timestamptz:=clock_timestamp();
begin
  if tg_op='UPDATE' and new.user_id=old.user_id and new.date=old.date then return new; end if;
  if tg_op<>'DELETE' then
    insert into public.streak_checkin_receipts(user_id,checkin_date,received_at,activation_pending)
      values(new.user_id,new.date,received,exists(select 1 from public.streak_reconciliation_state
        where user_id=new.user_id and received<activation_at and new.date<start_date)) on conflict do nothing;
    return new;
  end if;
  return old;
end;
$$;

create or replace function public.handle_mood_streak_activity()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare owner_id uuid;
begin
  if tg_op='UPDATE' and new.user_id=old.user_id and new.date=old.date then return new; end if;
  for owner_id in select distinct id from unnest(array[
    case when tg_op<>'INSERT' then old.user_id end,
    case when tg_op<>'DELETE' then new.user_id end]) id where id is not null order by id loop
    perform pg_advisory_xact_lock(hashtextextended('streak:'||owner_id::text,0));
  end loop;
  if tg_op<>'INSERT' and exists(select 1 from public.user_profile where user_id=old.user_id) then
    perform public.record_streak_activity(old.user_id,old.date);
  end if;
  if tg_op<>'DELETE' then
    perform public.record_streak_activity(new.user_id,new.date);
    return new;
  end if;
  return old;
end;
$$;

-- Existing Cook Together callers may still call this helper. It can reconcile,
-- but cannot invent a check-in. All recipe rewards and writes remain untouched.
create or replace function public.update_streak(p_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if auth.uid() is distinct from p_user_id and coalesce(auth.role(),'')<>'service_role' then
    raise exception 'Streak account mismatch' using errcode='42501';
  end if;
  perform public.record_streak_activity(p_user_id,public.scoring_date_at(p_user_id,clock_timestamp()));
end;
$$;

create or replace function public.reconcile_checkin_streak(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if coalesce(auth.role(),'')<>'service_role' or p_user_id is null then
    raise exception 'Trusted reconciliation required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('streak:'||p_user_id::text,0));
  return public.apply_checkin_streak(p_user_id,clock_timestamp());
end;
$$;

create or replace function public.read_checkin_streak_status(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare s public.streak_reconciliation_state%rowtype; n integer; dates jsonb; current_week date;
  state_name text; observed timestamptz:=statement_timestamp();
begin
  if p_user_id is null or (auth.uid() is distinct from p_user_id and coalesce(auth.role(),'')<>'service_role') then
    raise exception 'Streak account mismatch' using errcode='42501';
  end if;
  select * into s from public.streak_reconciliation_state where user_id=p_user_id;
  if not found then return jsonb_build_object('state','pending','reason','activation_missing',
    'count',null,'reconciledThrough',null,'protectedDates','[]'::jsonb,'allowance',null); end if;
  current_week:=date_trunc('week',public.scoring_date_at(p_user_id,observed))::date;
  state_name:=case when observed<s.activation_at then 'scheduled'
    when s.state='pending' then 'pending'
    when s.reconciled_through is null or s.reconciled_through<public.scoring_date_at(p_user_id,observed)-1 then 'pending'
    else s.state end;
  select streak_count into n from public.user_streaks where user_id=p_user_id;
  select coalesce(jsonb_agg(missed_date order by missed_date),'[]'::jsonb) into dates
    from public.user_streak_freezes where user_id=p_user_id and week_start=current_week;
  return jsonb_build_object('state',state_name,'count',case when state_name='current' then coalesce(n,0) else null end,
    'lastKnownCount',n,'reconciledThrough',s.reconciled_through,'activationAt',s.activation_at,
    'pendingDate',s.pending_date,'protectedDates',dates,
    'allowance',case when state_name<>'current' then null
      when not public.user_has_pro_access(p_user_id) then 0
      when jsonb_array_length(dates)>0 then 0 else 1 end);
end;
$$;

-- No client or service role may call internal workers with fabricated dates.
revoke all on function public.streak_day_end(uuid,date),
 public.initialize_checkin_streak(uuid,timestamptz), public.record_streak_access_evidence(),
 public.streak_access_at(uuid,timestamptz), public.build_checkin_streak(uuid,timestamptz),
 public.apply_checkin_streak(uuid,timestamptz), public.stamp_streak_checkin_receipt(),
 public.handle_mood_streak_activity(), public.record_streak_activity(uuid,date),
 public.update_streak(uuid), public.reconcile_checkin_streak(uuid), public.read_checkin_streak_status(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.update_streak(uuid) to authenticated,service_role;
grant execute on function public.reconcile_checkin_streak(uuid) to service_role;
grant execute on function public.read_checkin_streak_status(uuid) to authenticated,service_role;

select public.initialize_checkin_streak(user_id,clock_timestamp()) from public.user_profile order by user_id;
drop trigger if exists phase_c_profile_evidence on public.user_profile;
create trigger phase_c_profile_evidence after insert or update of manual_pro_grant or delete on public.user_profile
  for each row execute function public.record_streak_access_evidence();
drop trigger if exists phase_c_entitlement_evidence on public.subscription_entitlements;
create trigger phase_c_entitlement_evidence after insert or update or delete on public.subscription_entitlements
  for each row execute function public.record_streak_access_evidence();
drop trigger if exists phase_c_checkin_receipt on public.mood_logs;
create trigger phase_c_checkin_receipt before insert or update or delete on public.mood_logs
  for each row execute function public.stamp_streak_checkin_receipt();
-- Keep the existing AFTER trigger name/dependency; replace only its function.
commit;
