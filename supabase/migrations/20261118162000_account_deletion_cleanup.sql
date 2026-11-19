begin;
-- Minimal non-reversible purchase-reference barriers prevent late transactions
-- being claimed by another account after the original entitlement is erased.
-- Retention requires an approved billing/security purpose before activation.
create table public.account_deleted_purchase_references (
 reference_hash text primary key,
 removed_at timestamptz not null default clock_timestamp()
);
alter table public.account_deleted_purchase_references enable row level security;
revoke all on public.account_deleted_purchase_references from public,anon,authenticated,service_role;
create function public.privacy_purchase_reference(p_provider text,p_kind text,p_value text) returns text
language sql immutable set search_path=pg_catalog as $$
 select encode(sha256(convert_to(p_provider||':'||p_kind||':'||p_value,'UTF8')),'hex');
$$;
create function public.remember_deleted_purchase_references() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare ref text;
begin
 for ref in select public.privacy_purchase_reference(provider,'subscription',provider_subscription_id)
 from public.subscription_entitlements where user_id=new.user_id
 union select public.privacy_purchase_reference(provider,'account',account_reference)
 from public.subscription_account_links where user_id=new.user_id order by 1 loop
  perform pg_advisory_xact_lock(hashtextextended('privacy-purchase:'||ref,0));
  insert into public.account_deleted_purchase_references(reference_hash) values(ref) on conflict do nothing;
 end loop;
 return new;
end $$;
create trigger privacy_remember_purchases after insert on public.account_deletion_tombstones
 for each row execute function public.remember_deleted_purchase_references();
create function public.reject_deleted_purchase_reference() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare ref text;
begin
 ref:=public.privacy_purchase_reference(new.provider,tg_argv[0],to_jsonb(new)->>tg_argv[1]);
 perform pg_advisory_xact_lock(hashtextextended('privacy-purchase:'||ref,0));
 if exists(select 1 from public.account_deleted_purchase_references where reference_hash=ref) then
  raise exception 'Subscription unavailable' using errcode='23505';
 end if;
 return new;
end $$;
create trigger privacy_purchase_barrier before insert or update on public.subscription_entitlements
 for each row execute function public.reject_deleted_purchase_reference('subscription','provider_subscription_id');
create trigger privacy_purchase_barrier before insert or update on public.subscription_account_links
 for each row execute function public.reject_deleted_purchase_reference('account','account_reference');
revoke all on function public.privacy_purchase_reference(text,text,text),public.remember_deleted_purchase_references(),public.reject_deleted_purchase_reference()
 from public,anon,authenticated,service_role;
create function public.account_privacy_owner_removed(p_user_id uuid,p_provider text,p_subscription_id text,p_account_reference text default null)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 return exists(select 1 from public.account_deletion_tombstones where user_id=p_user_id)
 or exists(select 1 from public.account_deleted_purchase_references where reference_hash in
 (public.privacy_purchase_reference(p_provider,'subscription',p_subscription_id),public.privacy_purchase_reference(p_provider,'account',p_account_reference)));
end $$;
revoke all on function public.account_privacy_owner_removed(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.account_privacy_owner_removed(uuid,text,text,text) to service_role;
-- Existing maintenance logic is preserved; accepted deletion skips derived writes.
CREATE OR REPLACE FUNCTION public.refresh_effective_subscription_profile(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  provider_status text;
  compatibility_status text;
  v_stripe_customer_id text;
  v_stripe_subscription_id text;
  has_stripe_snapshot boolean := false;
begin
  -- Skip derived maintenance only for an accepted account deletion.
  if exists(select 1 from public.account_deletion_tombstones where user_id=p_user_id) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('subscription:' || p_user_id::text, 0));

  select entitlement.status
    into provider_status
  from public.subscription_entitlements entitlement
  where entitlement.user_id = p_user_id
    and entitlement.status in ('active', 'trialing', 'grace_period')
    and entitlement.current_period_end is not null
    and entitlement.current_period_end > now()
  order by
    case entitlement.status when 'trialing' then 0 when 'grace_period' then 1 else 2 end,
    entitlement.current_period_end desc,
    entitlement.last_verified_at desc nulls last,
    entitlement.updated_at desc
  limit 1;

  if provider_status is null then
    select case
      when entitlement.status in ('active', 'trialing', 'grace_period')
        and entitlement.current_period_end is null then 'unknown'
      when entitlement.status in ('active', 'trialing', 'grace_period')
        and entitlement.current_period_end <= now() then 'expired'
      else entitlement.status
    end
      into provider_status
    from public.subscription_entitlements entitlement
    where entitlement.user_id = p_user_id
    order by entitlement.last_verified_at desc nulls last, entitlement.updated_at desc
    limit 1;
  end if;

  compatibility_status := case
    when provider_status = 'trialing' then 'trialing'
    when provider_status in ('active', 'grace_period') then 'active'
    else provider_status
  end;

  select entitlement.provider_account_id, entitlement.provider_subscription_id
    into v_stripe_customer_id, v_stripe_subscription_id
  from public.subscription_entitlements entitlement
  where entitlement.user_id = p_user_id
    and entitlement.provider = 'stripe'
  order by entitlement.last_verified_at desc nulls last,
           entitlement.updated_at desc,
           entitlement.created_at desc
  limit 1;
  has_stripe_snapshot := found;

  update public.user_profile profile
  set subscription_status = compatibility_status,
      stripe_customer_id = case
        when has_stripe_snapshot then coalesce(v_stripe_customer_id, profile.stripe_customer_id)
        else profile.stripe_customer_id
      end,
      stripe_subscription_id = case
        when has_stripe_snapshot then v_stripe_subscription_id
        else profile.stripe_subscription_id
      end,
      updated_at = now()
  where profile.user_id = p_user_id
    and (
      profile.subscription_status is distinct from compatibility_status
      or (has_stripe_snapshot and profile.stripe_customer_id is distinct from coalesce(v_stripe_customer_id, profile.stripe_customer_id))
      or (has_stripe_snapshot and profile.stripe_subscription_id is distinct from v_stripe_subscription_id)
    );
end;
$function$;


CREATE OR REPLACE FUNCTION public.record_streak_activity(p_user_id uuid, p_activity_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare s public.streak_reconciliation_state%rowtype; observed timestamptz; n integer;
begin
  -- Skip derived maintenance only for an accepted account deletion.
  if exists(select 1 from public.account_deletion_tombstones where user_id=p_user_id) then return null; end if;
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
$function$;


CREATE OR REPLACE FUNCTION public.record_streak_access_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare at_time timestamptz:=clock_timestamp();
begin
  -- Accepted account deletion must not manufacture new access evidence.
  if tg_op='DELETE' and exists(select 1 from public.account_deletion_tombstones where user_id=old.user_id) then return old; end if;
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
$function$;


-- Tombstone content is explicit, never a retained supposedly anonymous post.
alter table public.posts add column removed_at timestamptz;
alter table public.comments add column removed_at timestamptz;
alter table public.comments alter column user_id drop not null;
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.comments'::regclass
 and contype='f' and confrelid='auth.users'::regclass loop
  execute format('alter table public.comments drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.comments add constraint comments_author_fk foreign key(user_id) references auth.users(id) on delete set null;
-- Existing set_comment_author_name runs on owner changes. Run after it so a
-- removed placeholder cannot acquire a fallback identity or later content.
create function public.scrub_removed_comment_identity() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.removed_at is not null then new.author_name:=null; new.content:=''; new.user_id:=null; new.anonymous:=false; end if;
 return new;
end $$;
create trigger zz_privacy_removed_comment before insert or update on public.comments
 for each row execute function public.scrub_removed_comment_identity();
revoke all on function public.scrub_removed_comment_identity() from public,anon,authenticated,service_role;

-- Object API deletion remains the worker's responsibility. This listing includes
-- known-prefix orphaned files as well as objects carrying Storage ownership.
create function public.list_account_privacy_objects(p_user_id uuid) returns table(bucket text,path text)
language sql stable security definer set search_path=pg_catalog,public as $$
 select o.bucket_id,o.name from storage.objects o
 where coalesce(auth.role(),'')='service_role'
 and (o.owner_id=p_user_id::text or (o.bucket_id in ('profile-photos','milestone-photos') and split_part(o.name,'/',1)=p_user_id::text))
 order by o.bucket_id,o.name,o.id limit 100;
$$;
create function public.guard_account_privacy_storage() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare owner_id uuid; actor uuid:=auth.uid(); prefix text;
begin
 prefix:=split_part(new.name,'/',1);
 if new.owner_id is not null then owner_id:=new.owner_id::uuid;
 elsif new.bucket_id in ('profile-photos','milestone-photos') and prefix ~* '^[0-9a-f-]{36}$' then owner_id:=prefix::uuid;
 else owner_id:=actor; end if;
 if owner_id is not null then
  perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||owner_id::text,0));
  if exists(select 1 from public.account_deletion_tombstones where user_id=owner_id) then
   raise exception 'Account unavailable' using errcode='42501'; end if;
 end if;
 if actor is not null and exists(select 1 from public.account_deletion_tombstones where user_id=actor) then
  raise exception 'Account unavailable' using errcode='42501'; end if;
 return new;
end $$;
create trigger account_privacy_storage_write before insert or update on storage.objects
 for each row execute function public.guard_account_privacy_storage();

-- Permit only the privileged privacy transaction to clear a removed actor.
-- Ordinary updates still preserve the original actor, including service updates.
create or replace function public.stamp_notification_calendar_actor() returns trigger
language plpgsql set search_path=pg_catalog,public as $$ begin
 if tg_op='UPDATE' and new.notification_actor_user_id is null
 and old.notification_actor_user_id is not null
 and current_setting('dadhealth.privacy_cleanup_owner',true)=old.notification_actor_user_id::text
 and current_user=(select pg_get_userbyid(proowner) from pg_proc where oid='public.cleanup_account_private_records(uuid,uuid)'::regprocedure)
 and exists(select 1 from public.account_deletion_tombstones where user_id=old.notification_actor_user_id) then
  return new;
 end if;
 new.notification_actor_user_id:=case when tg_op='INSERT' then auth.uid() else old.notification_actor_user_id end;
 return new;
end $$;

create function public.cleanup_account_private_records(p_id uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.account_privacy_operations;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select * into o from public.account_privacy_operations where id=p_id;
 if not found then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('account-privacy:'||o.user_id::text,0));
 select * into o from public.account_privacy_operations where id=p_id for update;
 if o.kind<>'delete' or o.lease_token is distinct from p_lease or o.lease_until<=clock_timestamp()
 or not exists(select 1 from public.account_deletion_tombstones where user_id=o.user_id) then return false; end if;
 if exists(select 1 from public.list_account_privacy_objects(o.user_id)) then raise exception 'Storage cleanup incomplete'; end if;
 -- Remove other recipients' stale community/calendar notifications rather than
 -- relaxing their immutable-content update trigger.
 delete from public.notification_inbox_events n where
 exists(select 1 from public.posts p where p.id::text=n.destination->>'post_id' and
 (p.user_id=o.user_id or exists(select 1 from public.anonymous_post_owners a where a.post_id=p.id and a.user_id=o.user_id)))
 or exists(select 1 from public.comments c where c.id::text=n.destination->>'comment_id' and c.user_id=o.user_id)
 or exists(select 1 from public.co_parenting_events e join public.co_parenting_schedules s on s.id=e.schedule_id
 where e.id::text=n.destination->>'event_id' and s.user_id=o.user_id);
 -- Remove owned leaves first. Keep only ancestors needed by another author's replies.
 with recursive keep(id) as (
   select id from public.comments where user_id is distinct from o.user_id
   union
   select c.parent_id from public.comments c join keep k on k.id=c.id where c.parent_id is not null
 ) delete from public.comments c where c.user_id=o.user_id and not exists(select 1 from keep k where k.id=c.id);
 delete from public.posts p where (p.user_id=o.user_id or exists(select 1 from public.anonymous_post_owners a where a.post_id=p.id and a.user_id=o.user_id))
 and not exists(select 1 from public.comments c where c.post_id=p.id);
 update public.posts p set user_id=null,content='',author_name=null,author_initials=null,author_meta=null,anonymous=false,removed_at=clock_timestamp()
 where p.user_id=o.user_id or exists(select 1 from public.anonymous_post_owners a where a.post_id=p.id and a.user_id=o.user_id);
 update public.comments set user_id=null,content='',author_name=null,anonymous=false,removed_at=clock_timestamp() where user_id=o.user_id;
 delete from public.anonymous_post_owners where user_id=o.user_id;
 delete from public.co_parenting_schedules where user_id=o.user_id;
 update public.co_parenting_schedules set co_parent_user_id=null where co_parent_user_id=o.user_id;
 update public.user_profile set co_parent_id=null where co_parent_id=o.user_id and user_id<>o.user_id;
 perform set_config('dadhealth.privacy_cleanup_owner',o.user_id::text,true);
 update public.co_parenting_events set notification_actor_user_id=null where notification_actor_user_id=o.user_id;
 perform set_config('dadhealth.privacy_cleanup_owner','',true);
 delete from public.account_export_artifacts where user_id=o.user_id;
 -- Remaining owned rows are removed by verified FK cascades during Auth removal.
 return true;
end $$;

create function public.cleanup_account_privacy_retention() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 delete from public.account_export_artifacts a where a.expires_at<=clock_timestamp()
 or exists(select 1 from public.account_deletion_tombstones t where t.user_id=a.user_id);
 delete from public.account_privacy_confirmations where expires_at<=clock_timestamp();
 delete from public.account_privacy_delivery_failures where created_at<clock_timestamp()-interval '30 days';
 delete from public.account_privacy_operations where completed_at<clock_timestamp()-interval '30 days'
 and state in ('completed','sent_for_delivery','delivery_failed','cancelled','failed');
 -- Required pending cleanup is never purged as though complete. Its worker
 -- records a terminal failure after bounded retries for operator intervention.
end $$;
revoke all on function public.guard_account_privacy_storage() from public,anon,authenticated,service_role;
revoke all on function public.list_account_privacy_objects(uuid),public.cleanup_account_private_records(uuid,uuid),public.cleanup_account_privacy_retention() from public,anon,authenticated;
grant execute on function public.list_account_privacy_objects(uuid),public.cleanup_account_private_records(uuid,uuid),public.cleanup_account_privacy_retention() to service_role;
commit;
