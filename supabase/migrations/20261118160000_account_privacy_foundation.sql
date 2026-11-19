begin;

-- These rows deliberately survive Auth removal. Never store exported content or
-- raw recovery/confirmation secrets in the operation ledger.
create table public.account_privacy_operations (
 id uuid primary key,
 user_id uuid not null,
 kind text not null check(kind in ('export','delete')),
 state text not null default 'queued' check(state in
 ('queued','processing','reconfirmation_required','sent_for_delivery','delivery_failed','cancelled','account_removed','cleanup_pending','completed','failed')),
 recovery_hash text not null check(length(recovery_hash)=64),
 destination text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 account_removed_at timestamptz,
 lease_token uuid,
 lease_until timestamptz,
 next_attempt_at timestamptz not null default clock_timestamp(),
 attempts integer not null default 0,
 checkpoint jsonb not null default '{}',
 failure_code text,
 provider_message_id text,
 handoff_at timestamptz,
 export_captured_at timestamptz,
 check(kind='export' or destination is null)
);
create unique index account_one_active_export on public.account_privacy_operations(user_id)
 where kind='export' and state in ('queued','processing','reconfirmation_required');
create unique index account_one_deletion on public.account_privacy_operations(user_id) where kind='delete';
create table public.account_privacy_confirmations (
 operation_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('export','delete')),
 secret_hash text not null check(length(secret_hash)=64),
 destination text,
 expires_at timestamptz not null,
 cleanup_material text,
 used_at timestamptz
);
-- A UUID barrier is necessary after Auth is gone. Retention is deliberately NOT
-- invented here; operators must approve a retention policy before activation.
create table public.account_deletion_tombstones (
 user_id uuid primary key,
 operation_id uuid not null unique,
 accepted_at timestamptz not null default clock_timestamp()
);
alter table public.account_privacy_operations enable row level security;
alter table public.account_privacy_confirmations enable row level security;
alter table public.account_deletion_tombstones enable row level security;
revoke all on public.account_privacy_operations,public.account_privacy_confirmations,public.account_deletion_tombstones from public,anon,authenticated;
grant select,insert,update,delete on public.account_privacy_operations,public.account_privacy_confirmations to service_role;
grant select on public.account_deletion_tombstones to service_role;

create function public.confirm_account_privacy_operation(p_user_id uuid,p_id uuid,p_kind text,p_hash text,p_destination text,p_expires_at timestamptz,p_cleanup_material text default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('account-privacy:'||p_user_id::text,0));
 if exists(select 1 from public.account_privacy_operations where id=p_id and
 (user_id<>p_user_id or kind<>p_kind or state<>'reconfirmation_required')) then raise exception 'Operation conflict' using errcode='23505'; end if;
 insert into public.account_privacy_confirmations(operation_id,user_id,kind,secret_hash,destination,expires_at,cleanup_material)
 values(p_id,p_user_id,p_kind,p_hash,p_destination,p_expires_at,p_cleanup_material)
 on conflict(operation_id) do update set secret_hash=excluded.secret_hash,destination=excluded.destination,expires_at=excluded.expires_at,cleanup_material=excluded.cleanup_material,used_at=null
 where account_privacy_confirmations.user_id=excluded.user_id and account_privacy_confirmations.kind=excluded.kind;
 if not found then raise exception 'Operation conflict' using errcode='23505'; end if;
end $$;

create function public.account_privacy_status(p_id uuid,p_user_id uuid,p_recovery_hash text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.account_privacy_operations;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into o from public.account_privacy_operations where id=p_id
 and ((p_user_id is not null and user_id=p_user_id) or
 (kind='delete' and p_recovery_hash is not null and recovery_hash=p_recovery_hash));
 if not found then return null; end if;
 return jsonb_build_object('id',o.id,'kind',o.kind,'state',o.state,
 'accountRemoved',o.account_removed_at is not null,'cleanupCompleted',o.kind='delete' and o.state='completed',
 'updatedAt',o.updated_at);
end $$;

create function public.request_account_privacy_operation(p_user_id uuid,p_id uuid,p_kind text,p_confirmation_hash text,p_recovery_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.account_privacy_confirmations; existing public.account_privacy_operations; destination text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_user_id is null or p_id is null or p_kind not in ('export','delete') or p_kind is null
 or p_recovery_hash is null or length(p_recovery_hash)<>64 then raise exception 'Invalid operation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('account-privacy:'||p_user_id::text,0));
 select * into existing from public.account_privacy_operations where id=p_id;
 if found then
  if existing.user_id<>p_user_id or existing.kind<>p_kind or existing.recovery_hash<>p_recovery_hash then
   raise exception 'Operation conflict' using errcode='23505'; end if;
  if existing.state<>'reconfirmation_required' then return public.account_privacy_status(p_id,p_user_id); end if;
 end if;
 if exists(select 1 from public.account_deletion_tombstones where user_id=p_user_id) then
  raise exception 'Account removal in progress' using errcode='42501'; end if;
 select * into c from public.account_privacy_confirmations where operation_id=p_id for update;
 if not found or c.user_id<>p_user_id or c.kind<>p_kind or c.secret_hash is distinct from p_confirmation_hash
 or c.used_at is not null or c.expires_at<=clock_timestamp() then
  raise exception 'Confirmation required' using errcode='42501'; end if;
 -- Auth is checked in the SAME database transaction, not a stale client email.
 select email into destination from auth.users where id=p_user_id and email_confirmed_at is not null for share;
 if p_kind='export' then
  if destination is null or destination is distinct from c.destination then
   raise exception 'Destination changed; reconfirm' using errcode='22023'; end if;
  if existing.id is null and exists(select 1 from public.account_privacy_operations where user_id=p_user_id and kind='export'
    and created_at>clock_timestamp()-interval '24 hours') then raise exception 'Export limit' using errcode='P0001'; end if;
 end if;
 insert into public.account_privacy_operations(id,user_id,kind,recovery_hash,destination)
 values(p_id,p_user_id,p_kind,p_recovery_hash,case when p_kind='export' then destination end)
 on conflict(id) do update set destination=excluded.destination,state='queued',next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
 where account_privacy_operations.user_id=p_user_id and account_privacy_operations.state='reconfirmation_required';
 update public.account_privacy_confirmations set used_at=clock_timestamp() where operation_id=p_id;
 if p_kind='delete' then
  if c.cleanup_material is not null then
   update public.account_privacy_operations set checkpoint=jsonb_build_object('appleRevocation',c.cleanup_material) where id=p_id;
  end if;
  update public.account_privacy_confirmations set cleanup_material=null where operation_id=p_id;
  insert into public.account_deletion_tombstones(user_id,operation_id) values(p_user_id,p_id);
  update public.account_privacy_operations set state='cancelled',completed_at=clock_timestamp(),updated_at=clock_timestamp(),
   lease_token=null,lease_until=null where user_id=p_user_id and kind='export' and handoff_at is null
   and state not in ('completed','cancelled','failed');
 end if;
 return public.account_privacy_status(p_id,p_user_id);
end $$;

create function public.claim_account_privacy_operations(p_limit integer default 5)
returns setof public.account_privacy_operations language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 return query with candidates as (
 select id from public.account_privacy_operations
 where state in ('queued','processing','account_removed','cleanup_pending')
 and next_attempt_at<=clock_timestamp() and (lease_until is null or lease_until<clock_timestamp())
 order by created_at,id for update skip locked limit greatest(1,least(p_limit,10)))
 update public.account_privacy_operations o set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '5 minutes',
 attempts=attempts+1,updated_at=clock_timestamp(),state=case when account_removed_at is null then 'processing' else 'cleanup_pending' end
 from candidates c where o.id=c.id returning o.*;
end $$;

-- Shared transaction locks drain existing owner writes before deletion is
-- accepted. The fresh check after waiting rejects stale/offline sessions.
create function public.guard_account_privacy_write() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare owner_id uuid; old_owner uuid;
begin
 owner_id:=nullif(to_jsonb(new)->>tg_argv[0],'')::uuid;
 if tg_op='UPDATE' then old_owner:=nullif(to_jsonb(old)->>tg_argv[0],'')::uuid; end if;
 -- Anonymous community writes still belong to the authenticated actor.
 if owner_id is null and tg_table_name='posts' then owner_id:=auth.uid(); end if;
 if owner_id is not null then
  perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||owner_id::text,0));
  if exists(select 1 from public.account_deletion_tombstones where user_id=owner_id) then
   raise exception 'Account unavailable' using errcode='42501'; end if;
 end if;
 if old_owner is not null and old_owner is distinct from owner_id and coalesce(auth.role(),'')<>'service_role'
 and exists(select 1 from public.account_deletion_tombstones where user_id=old_owner) then
  raise exception 'Account unavailable' using errcode='42501'; end if;
 return new;
end $$;

create function public.privacy_current_account_available() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select auth.uid() is not null and not exists(select 1 from public.account_deletion_tombstones where user_id=auth.uid());
$$;
revoke all on function public.privacy_current_account_available() from public,anon;
grant execute on function public.privacy_current_account_available() to authenticated;

do $$ declare t record; begin
 for t in select table_name from information_schema.columns where table_schema='public' and column_name='user_id'
 and data_type='uuid' and table_name not like 'account_%'
 and exists(select 1 from information_schema.tables i where i.table_schema='public' and i.table_name=columns.table_name and i.table_type='BASE TABLE')
 loop
  execute format('create trigger account_privacy_write before insert or update on public.%I for each row execute function public.guard_account_privacy_write(%L)',t.table_name,'user_id');
  execute format('create policy privacy_deleted_session on public.%I as restrictive for all to authenticated using (public.privacy_current_account_available()) with check (public.privacy_current_account_available())',t.table_name);
 end loop;
end $$;

revoke all on function public.guard_account_privacy_write() from public,anon,authenticated,service_role;
revoke all on function public.confirm_account_privacy_operation(uuid,uuid,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.confirm_account_privacy_operation(uuid,uuid,text,text,text,timestamptz,text) to service_role;
revoke all on function public.account_privacy_status(uuid,uuid,text),public.request_account_privacy_operation(uuid,uuid,text,text,text),public.claim_account_privacy_operations(integer) from public,anon,authenticated;
grant execute on function public.account_privacy_status(uuid,uuid,text),public.request_account_privacy_operation(uuid,uuid,text,text,text),public.claim_account_privacy_operations(integer) to service_role;
commit;
