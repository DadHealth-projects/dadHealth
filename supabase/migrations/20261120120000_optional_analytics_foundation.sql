begin;
-- No automatic business events. Access only through service-role validated APIs.
create table public.analytics_consents (
 id uuid primary key, user_id uuid, secret_hash text not null check(length(secret_hash)=64),
 expires_at timestamptz not null default (clock_timestamp()+interval '30 days'),
 distinct_id text not null, revoked_at timestamptz, created_at timestamptz not null default clock_timestamp()
);
create table public.analytics_outbox (
 id uuid primary key, consent_id uuid not null references public.analytics_consents(id) on delete cascade,
 user_id uuid, distinct_id text not null, event text not null,
 occurred_at timestamptz not null, properties jsonb not null check(jsonb_typeof(properties)='object' and octet_length(properties::text)<2048),
 created_at timestamptz not null default clock_timestamp(), state text not null default 'pending' check(state in ('pending','sending','sent','failed','cancelled')),
 attempts int not null default 0, next_at timestamptz not null default clock_timestamp(),
 lease uuid, lease_until timestamptz, delivered_at timestamptz
);
create index analytics_due on public.analytics_outbox(next_at) where state in ('pending','sending');
create index analytics_owner on public.analytics_outbox(user_id);
create table public.analytics_rate_limits (key text primary key, window_at timestamptz not null, count int not null);
alter table public.analytics_consents enable row level security;
alter table public.analytics_outbox enable row level security;
alter table public.analytics_rate_limits enable row level security;
revoke all on public.analytics_consents,public.analytics_outbox,public.analytics_rate_limits from public,anon,authenticated,service_role;
grant select on public.analytics_consents,public.analytics_outbox to service_role;

create function public.analytics_rate_limit(p_key text,p_limit int default 60) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n int;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 if length(p_key)<>64 then raise exception 'Invalid key'; end if;
 insert into public.analytics_rate_limits(key,window_at,count) values(p_key,clock_timestamp(),1)
 on conflict(key) do update set count=case when analytics_rate_limits.window_at<clock_timestamp()-interval '1 minute' then 1 else analytics_rate_limits.count+1 end,
 window_at=case when analytics_rate_limits.window_at<clock_timestamp()-interval '1 minute' then clock_timestamp() else analytics_rate_limits.window_at end returning count into n;
 return n<=least(greatest(p_limit,1),300);
end $$;

-- New grants allocate server-generated identifiers; ingestion cannot recreate them.
create function public.issue_analytics_consent(p_owner uuid,p_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.analytics_consents;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501';end if;
 if p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid capability';end if;
 if p_owner is not null then
  perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||p_owner::text,0));
  if not exists(select 1 from auth.users where id=p_owner) or exists(select 1 from public.account_deletion_tombstones where user_id=p_owner) then return null;end if;
 end if;
 insert into public.analytics_consents(id,user_id,secret_hash,distinct_id) values(gen_random_uuid(),p_owner,p_hash,coalesce(p_owner::text,'anonymous-'||p_hash)) returning * into c;
 return jsonb_build_object('consent',c.id,'expiresAt',c.expires_at);
end $$;
create function public.renew_analytics_consent(p_owner uuid,p_consent uuid,p_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.analytics_consents;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501';end if;
 if p_owner is not null then perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||p_owner::text,0));end if;
 perform pg_advisory_xact_lock(hashtextextended('analytics-consent:'||p_consent::text,0));
 if exists(select 1 from public.account_deletion_tombstones where user_id=p_owner) then return null;end if;
 update public.analytics_consents set expires_at=clock_timestamp()+interval '30 days'
 where id=p_consent and user_id is not distinct from p_owner and secret_hash=p_hash and revoked_at is null and expires_at>clock_timestamp() returning * into c;
 if not found then return null;end if;
 return jsonb_build_object('consent',c.id,'expiresAt',c.expires_at);
end $$;
revoke all on function public.issue_analytics_consent(uuid,text),public.renew_analytics_consent(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.issue_analytics_consent(uuid,text),public.renew_analytics_consent(uuid,uuid,text) to service_role;

create function public.ingest_optional_analytics(p_owner uuid,p_consent uuid,p_hash text,p_event jsonb,p_withdraw boolean default false) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.analytics_consents; e public.analytics_outbox; identity text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 if length(p_hash)<>64 or p_consent is null then raise exception 'Invalid consent'; end if;
 -- Lock order matches deletion acceptance: owner barrier, then consent, then row.
 if p_owner is not null then perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||p_owner::text,0)); end if;
 perform pg_advisory_xact_lock(hashtextextended('analytics-consent:'||p_consent::text,0));
 identity:=coalesce(p_owner::text,'anonymous-'||p_hash);
 select * into c from public.analytics_consents where id=p_consent for update;
 if found and c.secret_hash<>p_hash then return 'conflict'; end if;
 if not found then return case when p_withdraw then 'withdrawn' else 'expired' end; end if;
 if c.user_id is distinct from p_owner then return 'conflict'; end if;
 if p_withdraw then
  update public.analytics_consents set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_consent;
  delete from public.analytics_outbox where consent_id=p_consent and state not in ('sending','sent');
  return 'withdrawn';
 end if;
 if c.expires_at<=clock_timestamp() then return 'expired'; end if;
 if p_owner is not null and (not exists(select 1 from auth.users where id=p_owner)
   or exists(select 1 from public.account_deletion_tombstones where user_id=p_owner)) then return 'removed'; end if;
 if c.revoked_at is not null then return 'revoked'; end if;
 if p_event is null or octet_length(p_event::text)>4096 or p_event->>'event' not in
 ('$pageview','app_opened','onboarding_started','paywall_viewed','paywall_opened','lock_viewed','lock_tapped','upgrade_moment_shown','upgrade_moment_dismissed','breath_session_started','journal_entry_created','dad_days_search_limit_reached')
 or (p_event->>'timestamp')::timestamptz<clock_timestamp()-interval '7 days'
 or (p_event->>'timestamp')::timestamptz>clock_timestamp()+interval '1 minute' then return 'invalid'; end if;

 select * into e from public.analytics_outbox where id=(p_event->>'id')::uuid;
 if found then
  if e.consent_id<>p_consent or e.event<>p_event->>'event' or e.occurred_at<>(p_event->>'timestamp')::timestamptz or e.properties<>p_event->'properties' then return 'conflict'; end if;
  return 'accepted';
 end if;
 if (select count(*) from public.analytics_outbox where consent_id=p_consent and state in ('pending','sending'))>=200 then return 'limited'; end if;
 insert into public.analytics_outbox(id,consent_id,user_id,distinct_id,event,occurred_at,properties)
 values((p_event->>'id')::uuid,p_consent,p_owner,identity,p_event->>'event',(p_event->>'timestamp')::timestamptz,p_event->'properties');
 return 'accepted';
end $$;

create function public.claim_optional_analytics() returns setof public.analytics_outbox
language plpgsql security definer set search_path=pg_catalog,public as $$
declare candidate public.analytics_outbox;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 -- Select at most one. Locks are acquired in the same order as deletion/withdrawal.
 select * into candidate from public.analytics_outbox where state in ('pending','sending') and attempts<8 and next_at<=clock_timestamp()
 and (lease_until is null or lease_until<clock_timestamp()) and occurred_at>clock_timestamp()-interval '7 days' order by next_at,id limit 1;
 if not found then return; end if;
 if candidate.user_id is not null then perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||candidate.user_id::text,0)); end if;
 perform pg_advisory_xact_lock(hashtextextended('analytics-consent:'||candidate.consent_id::text,0));
 if exists(select 1 from public.analytics_consents where id=candidate.consent_id and revoked_at is not null)
 or exists(select 1 from public.account_deletion_tombstones where user_id=candidate.user_id) then
  delete from public.analytics_outbox where id=candidate.id; return;
 end if;
 return query update public.analytics_outbox set state='sending',attempts=attempts+1,lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds'
 where id=candidate.id and state in ('pending','sending') and (lease_until is null or lease_until<clock_timestamp()) returning *;
end $$;

-- Recheck after claiming, immediately before HTTP. An already in-flight request
-- cannot be recalled; deletion waits for its lease before remote erasure.
create function public.authorize_optional_analytics(p_id uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare e public.analytics_outbox;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into e from public.analytics_outbox where id=p_id;
 if not found then return false; end if;
 if e.user_id is not null then perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||e.user_id::text,0)); end if;
 perform pg_advisory_xact_lock(hashtextextended('analytics-consent:'||e.consent_id::text,0));
 return exists(select 1 from public.analytics_outbox o join public.analytics_consents c on c.id=o.consent_id
 where o.id=p_id and o.lease=p_lease and o.state='sending' and o.lease_until>clock_timestamp()+interval '10 seconds'
 and c.revoked_at is null
and o.occurred_at > clock_timestamp() - interval '7 days' and not exists(select 1 from public.account_deletion_tombstones t where t.user_id=o.user_id));
end $$;
revoke all on function public.authorize_optional_analytics(uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_optional_analytics(uuid,uuid) to service_role;

create function public.finish_optional_analytics(p_id uuid,p_lease uuid,p_result text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_result not in ('sent','retry','failed') then raise exception 'Invalid result'; end if;
 update public.analytics_outbox set state=case when p_result='retry' then case when attempts>=8 then 'failed' else 'pending' end else p_result end,
 delivered_at=case when p_result='sent' then clock_timestamp() end, lease=null,lease_until=null,
 next_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,attempts)::int)) where id=p_id and lease=p_lease;
 return found;
end $$;

create function public.stop_deleted_analytics() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 -- The inserting privacy operation already owns the exclusive owner barrier.
 update public.analytics_consents set revoked_at=coalesce(revoked_at,clock_timestamp()) where user_id=new.user_id;
 delete from public.analytics_outbox where user_id=new.user_id and state<>'sending';
 return new;
end $$;
create trigger stop_deleted_analytics after insert on public.account_deletion_tombstones for each row execute function public.stop_deleted_analytics();

create function public.cleanup_optional_analytics() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 delete from public.analytics_outbox where (lease_until is null or lease_until<clock_timestamp()) and
 ((state<>'sent' and occurred_at<clock_timestamp()-interval '7 days') or created_at<clock_timestamp()-interval '30 days'
 or exists(select 1 from public.analytics_consents c where c.id=consent_id and c.revoked_at is not null));
 delete from public.analytics_rate_limits where window_at<clock_timestamp()-interval '1 day';
 -- Seven-day events cannot survive a 30-day revocation receipt. A new consent
 -- requires a fresh capability; old timestamps are rejected even after cleanup.
 delete from public.analytics_consents where id in (select c.id from public.analytics_consents c
 where ((c.revoked_at is null and c.expires_at<clock_timestamp()) or c.revoked_at<clock_timestamp()-interval '30 days')
 and not exists(select 1 from public.analytics_outbox e where e.consent_id=c.id) for update skip locked);
end $$;

create function public.purge_deleted_analytics(p_owner uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('account-privacy:'||p_owner::text,0));
 if not exists(select 1 from public.account_deletion_tombstones where user_id=p_owner) then raise exception 'Deletion required'; end if;
 -- Drain authorized bounded HTTP attempts before remote erasure. New claims are blocked.
 if exists(select 1 from public.analytics_outbox where user_id=p_owner and lease_until>clock_timestamp()) then return false; end if;
 delete from public.analytics_outbox where user_id=p_owner;
 delete from public.analytics_consents where user_id=p_owner;
 return true;
end $$;
revoke all on function public.purge_deleted_analytics(uuid) from public,anon,authenticated;
grant execute on function public.purge_deleted_analytics(uuid) to service_role;

-- Wrap, rather than rewrite, the installed atomic export inventory.
alter function public.account_export_dataset(uuid) rename to account_export_dataset_before_analytics;
create function public.account_export_dataset(p_user_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_set(jsonb_set(public.account_export_dataset_before_analytics(p_user_id),'{sections,optionalAnalytics}',
 coalesce((select jsonb_agg(jsonb_build_object('id',id,'event',event,'timestamp',occurred_at,'properties',properties,'deliveryState',state) order by occurred_at,id)
 from public.analytics_outbox where user_id=p_user_id),'[]'::jsonb)), '{sections,optionalAnalyticsConsent}',
 coalesce((select jsonb_agg(jsonb_build_object('createdAt',created_at,'withdrawnAt',revoked_at) order by created_at,id)
 from public.analytics_consents where user_id=p_user_id),'[]'::jsonb));
$$;
-- Unchanged: matches the existing private-helper boundary.
revoke all on function
  public.account_export_dataset(uuid),
  public.stop_deleted_analytics()
from public, anon, authenticated, service_role;
revoke all on function public.analytics_rate_limit(text,int),public.ingest_optional_analytics(uuid,uuid,text,jsonb,boolean),public.claim_optional_analytics(),public.finish_optional_analytics(uuid,uuid,text),public.cleanup_optional_analytics() from public,anon,authenticated;
grant execute on function public.analytics_rate_limit(text,int),public.ingest_optional_analytics(uuid,uuid,text,jsonb,boolean),public.claim_optional_analytics(),public.finish_optional_analytics(uuid,uuid,text),public.cleanup_optional_analytics() to service_role;
commit;
