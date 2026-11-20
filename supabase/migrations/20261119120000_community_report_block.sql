begin;
create table public.community_reports (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 target_kind text not null check(target_kind in ('post','comment')),
 target_id uuid not null,
 reason text not null check(reason in ('bullying','hate','harmful','spam','other')),
 explanation text not null default '' check(char_length(explanation)<=1000),
 content_excerpt text not null check(char_length(content_excerpt)<=500),
 created_at timestamptz not null default clock_timestamp(),
 resolved_at timestamptz,
 retention_hold_reason text check(retention_hold_reason is null or char_length(btrim(retention_hold_reason)) between 1 and 1000),
 retention_hold_at timestamptz,
 unique(user_id,target_kind,target_id)
);
-- Report evidence is private and fixed at receipt; resolution/hold changes remain allowed.
create function public.preserve_community_report_evidence() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if row(new.id,new.user_id,new.target_kind,new.target_id,new.reason,new.explanation,new.content_excerpt,new.created_at)
 is distinct from row(old.id,old.user_id,old.target_kind,old.target_id,old.reason,old.explanation,old.content_excerpt,old.created_at)
 then raise exception 'Report evidence is immutable' using errcode='22023'; end if;
 return new;
end $$;
revoke all on function public.preserve_community_report_evidence() from public,anon,authenticated,service_role;
create trigger community_report_evidence before update on public.community_reports
for each row execute function public.preserve_community_report_evidence();
create index community_reports_owner_time on public.community_reports(user_id,created_at);
create table public.community_blocks (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 blocked_user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),
 unique(user_id,blocked_user_id), check(user_id<>blocked_user_id)
);
create table public.community_report_delivery (
 report_id uuid primary key references public.community_reports(id) on delete cascade,
 state text not null default 'queued' check(state in ('queued','processing','accepted','needs_review')),
 attempts integer not null default 0,
 first_attempt_at timestamptz,
 next_attempt_at timestamptz not null default clock_timestamp(),
 lease_token uuid, lease_until timestamptz,
 provider_message_id text, failure_code text,
 accepted_at timestamptz
);
create table public.community_report_retention (
 singleton boolean primary key default true check(singleton),
 days_after_resolution integer check(days_after_resolution between 1 and 3650)
);
insert into public.community_report_retention values(true,90);
alter table public.community_reports enable row level security;
alter table public.community_blocks enable row level security;
alter table public.community_report_delivery enable row level security;
alter table public.community_report_retention enable row level security;
revoke all on public.community_reports,public.community_blocks,public.community_report_delivery,public.community_report_retention from public,anon,authenticated,service_role;
-- Private identity and delivery state are never returned by client reads.
create trigger account_privacy_write before insert or update on public.community_reports
for each row execute function public.guard_account_privacy_write('user_id');
create trigger account_privacy_write before insert or update on public.community_blocks
for each row execute function public.guard_account_privacy_write('user_id');

create function public.community_target_author(p_kind text,p_id uuid) returns uuid
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(p.user_id,a.user_id) from public.posts p left join public.anonymous_post_owners a on a.post_id=p.id
 where p_kind='post' and p.id=p_id and p.removed_at is null
 union all select c.user_id from public.comments c where p_kind='comment' and c.id=p_id and c.removed_at is null;
$$;
create function public.community_author_visible(p_kind text,p_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select not exists(select 1 from public.community_blocks b where b.user_id=auth.uid()
 and b.blocked_user_id=public.community_target_author(p_kind,p_id));
$$;
-- Restrictive policies compose with all installed circle and deletion policies.
create policy community_blocked_posts on public.posts as restrictive for select to authenticated
 using(public.community_author_visible('post',id));
create policy community_blocked_comments on public.comments as restrictive for select to authenticated
 using(public.community_author_visible('comment',id) and public.community_author_visible('post',post_id));
create or replace function public.can_read_community_post(p_post_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.posts p left join public.circles c on c.id=p.circle_id
 where p.id=p_post_id and (p.circle_id is null or c.visibility='public' or public.is_circle_member(c.id))
 and public.community_author_visible('post',p.id));
$$;
create or replace function public.can_read_community_comment(p_comment_id uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.comments c where c.id=p_comment_id
 and public.can_read_community_post(c.post_id) and public.community_author_visible('comment',c.id));
$$;
create function public.submit_community_report(p_kind text,p_id uuid,p_reason text,p_explanation text default '') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); r public.community_reports; observed timestamptz; excerpt text;
begin
 if actor is null or not public.privacy_current_account_available() then raise exception 'Sign in required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||actor::text,0));
 perform pg_advisory_xact_lock(hashtextextended('community-report:'||actor::text,0));
 if p_kind is null or p_kind not in ('post','comment') or p_id is null or p_reason is null
 or p_reason not in ('bullying','hate','harmful','spam','other') or p_explanation is null or char_length(p_explanation)>1000
 then raise exception 'Invalid report' using errcode='22023'; end if;
 select * into r from public.community_reports where user_id=actor and target_kind=p_kind and target_id=p_id;
 if found then return jsonb_build_object('state','received','id',r.id); end if;
 if not (case p_kind when 'post' then public.can_read_community_post(p_id) else public.can_read_community_comment(p_id) end)
 or public.community_target_author(p_kind,p_id) is null then raise exception 'Content unavailable' using errcode='42501'; end if;
 if p_kind='post' then
   select left(content,500) into excerpt from public.posts where id=p_id and removed_at is null and public.can_read_community_post(id) for share;
 else
   select left(content,500) into excerpt from public.comments where id=p_id and removed_at is null and public.can_read_community_comment(id) for share;
 end if;
 if excerpt is null then raise exception 'Content unavailable' using errcode='42501'; end if;
 observed:=clock_timestamp();
 if (select count(*) from public.community_reports where user_id=actor and created_at>observed-interval '1 hour')>=10
 or (select count(*) from public.community_reports where user_id=actor and created_at>observed-interval '24 hours')>=50
 then raise exception 'Report limit reached' using errcode='P0001'; end if;
 insert into public.community_reports(user_id,target_kind,target_id,reason,explanation,content_excerpt,created_at)
 values(actor,p_kind,p_id,p_reason,p_explanation,excerpt,observed) returning * into r;
 insert into public.community_report_delivery(report_id) values(r.id);
 return jsonb_build_object('state','received','id',r.id);
end $$;
create function public.block_community_author(p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=auth.uid(); target uuid; block_id uuid;
begin
 if actor is null or not public.privacy_current_account_available() then raise exception 'Sign in required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||actor::text,0));
 if p_kind is null or p_kind not in ('post','comment') then raise exception 'Invalid target' using errcode='22023'; end if;
 target:=public.community_target_author(p_kind,p_id);
 if target is null or target=actor then raise exception 'Cannot block this account' using errcode='22023'; end if;
 select id into block_id from public.community_blocks where user_id=actor and blocked_user_id=target;
 if block_id is not null then return jsonb_build_object('state','blocked','id',block_id); end if;
 if not(case p_kind when 'post' then public.can_read_community_post(p_id) else public.can_read_community_comment(p_id) end)
 then raise exception 'Content unavailable' using errcode='42501'; end if;
 insert into public.community_blocks(user_id,blocked_user_id) values(actor,target)
 on conflict(user_id,blocked_user_id) do update set user_id=excluded.user_id returning id into block_id;
 return jsonb_build_object('state','blocked','id',block_id);
end $$;
create function public.list_community_blocks() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if not public.privacy_current_account_available() then raise exception 'Sign in required' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'label','Blocked dad','createdAt',created_at) order by created_at,id)
 from public.community_blocks where user_id=auth.uid()),'[]');
end $$;
create function public.unblock_community_author(p_block_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not public.privacy_current_account_available() then raise exception 'Sign in required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||auth.uid()::text,0));
 delete from public.community_blocks where id=p_block_id and user_id=auth.uid();
 return jsonb_build_object('state','unblocked');
end $$;

create function public.claim_community_report_delivery() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.community_report_delivery; r public.community_reports; observed timestamptz:=clock_timestamp();
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 -- Stop ambiguous replays before Resend's 24-hour idempotency window expires.
 update public.community_report_delivery set state='needs_review',failure_code='handoff_window_expired',lease_token=null,lease_until=null
 where state in ('queued','processing') and first_attempt_at<observed-interval '23 hours' and (lease_until is null or lease_until<=observed);
 select * into d from public.community_report_delivery where state in ('queued','processing') and next_attempt_at<=observed
 and (lease_until is null or lease_until<=observed) order by next_attempt_at,report_id for update skip locked limit 1;
 if not found then return null; end if;
 update public.community_report_delivery set state='processing',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,observed),
 lease_token=gen_random_uuid(),lease_until=observed+interval '2 minutes' where report_id=d.report_id returning * into d;
 select * into r from public.community_reports where id=d.report_id;
 return jsonb_build_object('id',r.id,'lease',d.lease_token,'kind',r.target_kind,'target',r.target_id,'reason',r.reason,'explanation',r.explanation,'excerpt',r.content_excerpt,'createdAt',r.created_at);
end $$;
create function public.finish_community_report_delivery(p_id uuid,p_lease uuid,p_message_id text default null) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 update public.community_report_delivery set state=case when p_message_id is null then 'queued' else 'accepted' end,
 provider_message_id=p_message_id,accepted_at=case when p_message_id is not null then clock_timestamp() else null end,
 failure_code=case when p_message_id is null then 'provider_unconfirmed' else null end,
 next_attempt_at=clock_timestamp()+interval '5 minutes',lease_token=null,lease_until=null
 where report_id=p_id and lease_token=p_lease and lease_until>clock_timestamp();
 return found;
end $$;
-- Trusted-operator resolution and retention holds. Releasing a hold preserves resolved_at.
create function public.resolve_community_report(p_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 update public.community_reports set resolved_at=coalesce(resolved_at,clock_timestamp()) where id=p_id;
end $$;
create function public.hold_community_report(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_reason is not null and (char_length(btrim(p_reason))<1 or char_length(p_reason)>1000) then raise exception 'Hold reason required' using errcode='22023'; end if;
 update public.community_reports set retention_hold_reason=case when p_reason is null then null else btrim(p_reason) end,
 retention_hold_at=case when p_reason is null then null else clock_timestamp() end where id=p_id;
 if not found then raise exception 'Report not found' using errcode='22023'; end if;
end $$;
revoke all on function public.hold_community_report(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.hold_community_report(uuid,text) to service_role;
create function public.purge_resolved_community_reports() returns integer
language plpgsql security definer set search_path=pg_catalog,public as $$
declare days integer; deleted integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 select days_after_resolution into days from public.community_report_retention where singleton;
 if days is null then return 0; end if;
 delete from public.community_reports where retention_hold_reason is null and resolved_at<clock_timestamp()-make_interval(days=>days);
 get diagnostics deleted=row_count; return deleted;
end $$;
-- Extend new captures only, retaining the original stable capture under a private name.
alter function public.account_export_dataset(uuid) rename to account_export_dataset_before_moderation;
create function public.account_export_dataset(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 result:=public.account_export_dataset_before_moderation(p_user_id);
 return jsonb_set(result,'{sections}',(result->'sections')||jsonb_build_object(
 'community_reports',coalesce((select jsonb_agg(jsonb_build_object('id',id,'target_kind',target_kind,'target_id',target_id,'reason',reason,'explanation',explanation,'created_at',created_at) order by created_at,id) from public.community_reports where user_id=p_user_id),'[]'),
 'community_blocks',coalesce((select jsonb_agg(jsonb_build_object('id',id,'label','Blocked dad','created_at',created_at) order by created_at,id) from public.community_blocks where user_id=p_user_id),'[]')));
end $$;
revoke all on function public.community_target_author(text,uuid),public.community_author_visible(text,uuid),public.submit_community_report(text,uuid,text,text),public.block_community_author(text,uuid),public.list_community_blocks(),public.unblock_community_author(uuid),public.claim_community_report_delivery(),public.finish_community_report_delivery(uuid,uuid,text),public.resolve_community_report(uuid),public.purge_resolved_community_reports(),public.account_export_dataset(uuid) from public,anon,authenticated,service_role;
grant execute on function public.community_author_visible(text,uuid) to authenticated;
grant execute on function public.submit_community_report(text,uuid,text,text),public.block_community_author(text,uuid),public.list_community_blocks(),public.unblock_community_author(uuid) to authenticated;
grant execute on function public.claim_community_report_delivery(),public.finish_community_report_delivery(uuid,uuid,text),public.resolve_community_report(uuid),public.purge_resolved_community_reports() to service_role;
create or replace function public.get_community_author_avatars(
  p_post_ids uuid[],
  p_comment_ids uuid[]
)
returns table(contribution_id uuid, avatar_url text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select post.id, nullif(btrim(profile.avatar_url), '')
  from public.posts post
  join public.user_profile profile on profile.user_id = post.user_id
  where auth.uid() is not null
    and post.id = any(coalesce(p_post_ids, '{}'::uuid[]))
    and coalesce(cardinality(p_post_ids), 0) + coalesce(cardinality(p_comment_ids), 0) <= 250
    and post.anonymous is false
    and public.can_read_community_post(post.id)
    and nullif(btrim(profile.avatar_url), '') is not null

  union all

  select comment.id, nullif(btrim(profile.avatar_url), '')
  from public.comments comment
  join public.user_profile profile on profile.user_id = comment.user_id
  where auth.uid() is not null
    and comment.id = any(coalesce(p_comment_ids, '{}'::uuid[]))
    and coalesce(cardinality(p_post_ids), 0) + coalesce(cardinality(p_comment_ids), 0) <= 250
    and comment.anonymous is false
    and public.can_read_community_comment(comment.id)
    and nullif(btrim(profile.avatar_url), '') is not null;
$$;

revoke all on function public.get_community_author_avatars(uuid[], uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_community_author_avatars(uuid[], uuid[])
  to authenticated;


commit;
