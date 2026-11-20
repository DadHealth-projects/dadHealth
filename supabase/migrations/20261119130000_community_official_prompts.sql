begin;
create table public.community_publishers (
 user_id uuid primary key references auth.users(id) on delete cascade,
 granted_at timestamptz not null default clock_timestamp()
);
alter table public.community_publishers enable row level security;
revoke all on public.community_publishers from public,anon,authenticated,service_role;
-- Grants are operator SQL only; no app role can promote itself or anyone else.
create function public.guard_community_publisher() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from auth.users where id=new.user_id and email_confirmed_at is not null)
 or exists(select 1 from public.account_deletion_tombstones where user_id=new.user_id)
 then raise exception 'Verified active publisher required' using errcode='42501'; end if;
 return new;
end $$;
create trigger community_publisher_verified before insert or update on public.community_publishers for each row execute function public.guard_community_publisher();
create trigger account_privacy_write before insert or update on public.community_publishers for each row execute function public.guard_account_privacy_write('user_id');
alter table public.posts add column official_author boolean not null default false;
alter table public.comments add column official_author boolean not null default false;
create function public.stamp_community_official_author() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 -- Client metadata is never authority. Anonymous posts cannot carry an official badge.
 if tg_op='INSERT' then
   new.official_author:=exists(select 1 from public.community_publishers where user_id=new.user_id);
 else
   -- Preserve the original stamp, never promote old content on an edit/grant.
   new.official_author:=old.official_author and new.user_id is not distinct from old.user_id;
 end if;
 new.official_author:=new.official_author and new.user_id is not null
   and not coalesce(new.anonymous,false) and new.removed_at is null;
 if new.official_author then new.author_name:='Dad Health'; end if;
 return new;
end $$;
create trigger zz_community_official_author before insert or update on public.posts for each row execute function public.stamp_community_official_author();
create trigger zzz_community_official_author before insert or update on public.comments for each row execute function public.stamp_community_official_author();
create function public.get_community_official_authors(p_post_ids uuid[],p_comment_ids uuid[]) returns table(contribution_id uuid)
language sql stable security definer set search_path=pg_catalog,public as $$
 select p.id from posts p where cardinality(coalesce(p_post_ids,'{}'))+cardinality(coalesce(p_comment_ids,'{}'))<=250
 and p.id=any(coalesce(p_post_ids,'{}')) and p.official_author and not p.anonymous and p.removed_at is null and can_read_community_post(p.id)
 union all
 select c.id from comments c where cardinality(coalesce(p_post_ids,'{}'))+cardinality(coalesce(p_comment_ids,'{}'))<=250
 and c.id=any(coalesce(p_comment_ids,'{}')) and c.official_author and not c.anonymous and c.removed_at is null and can_read_community_comment(c.id);
$$;
revoke all on function public.guard_community_publisher(),public.stamp_community_official_author(),public.get_community_official_authors(uuid[],uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_community_official_authors(uuid[],uuid[]) to authenticated;

-- Provenance is private and separate from the existing circle_prompts catalogue.
-- Keep a non-content seed receipt after post deletion so reimport cannot resurrect it.
create table public.community_prompt_seeds (
 seed_key text primary key,
 publisher_id uuid references auth.users(id) on delete set null,
 circle_id uuid references public.circles(id) on delete set null,
 post_id uuid unique references public.posts(id) on delete set null deferrable initially deferred,
 content_sha256 bytea not null,
 seed_source text not null default 'Jamie supplied 2026-11-19'
);
alter table public.community_prompt_seeds enable row level security;
revoke all on public.community_prompt_seeds from public,anon,authenticated,service_role;
-- Only the private importer writes receipts under the account-privacy lock.
-- Do not attach the ordinary write barrier here: FK SET NULL during approved
-- deletion must remove publisher/post references even after the barrier exists.
-- Only the trusted importer can create the private receipt which authorises this
-- marker. Client-supplied flags are overwritten; normal edits cannot gain it.
alter table public.posts add column seeded_prompt boolean not null default false;
create function public.stamp_community_seed() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if tg_op='INSERT' then
   new.seeded_prompt:=exists(select 1 from public.community_prompt_seeds s
     where s.post_id=new.id and s.publisher_id=new.user_id and s.circle_id=new.circle_id
       and s.content_sha256=sha256(convert_to(new.content,'UTF8')) and not coalesce(new.anonymous,false));
 else new.seeded_prompt:=old.seeded_prompt;
 end if;
 return new;
end $$;
revoke all on function public.stamp_community_seed() from public,anon,authenticated,service_role;
create trigger zy_community_seed before insert or update on public.posts for each row execute function public.stamp_community_seed();
-- Preserve production's five named manual posts per UTC hour.
-- Validate seed provenance here because this trigger runs before
-- zy_community_seed. Never trust a client-supplied seeded_prompt flag.
create or replace function public.enforce_community_post_hourly_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  posts_this_hour integer;
begin
  new.seeded_prompt := false;

  if new.anonymous is true or new.user_id is null then
    return new;
  end if;

  new.seeded_prompt := exists (
    select 1
    from public.community_prompt_seeds s
    where s.post_id = new.id
      and s.publisher_id = new.user_id
      and s.circle_id = new.circle_id
      and s.content_sha256 =
          pg_catalog.sha256(pg_catalog.convert_to(new.content, 'UTF8'))
  );

  if new.seeded_prompt then
    return new;
  end if;

  -- Preserve serialization of concurrent manual submissions.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text, 872301)
  );

  select count(*)
  into posts_this_hour
  from public.posts
  where user_id = new.user_id
    and anonymous is not true
    and seeded_prompt is false
    and created_at >=
        date_trunc('hour', new.created_at at time zone 'UTC')
        at time zone 'UTC'
    and created_at < (
      date_trunc('hour', new.created_at at time zone 'UTC')
      + interval '1 hour'
    ) at time zone 'UTC';

  if posts_this_hour >= 5 then
    raise exception 'community_hourly_post_limit'
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;
create function public.preview_community_prompt_import(p_prompts jsonb,p_publisher_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare item jsonb; circle uuid; n integer; result jsonb:='[]'; existing public.community_prompt_seeds; action text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if not exists(select 1 from public.community_publishers p join auth.users u on u.id=p.user_id
   where p.user_id=p_publisher_id and u.email_confirmed_at is not null)
 or exists(select 1 from public.account_deletion_tombstones where user_id=p_publisher_id)
 then raise exception 'Verified active publisher required' using errcode='42501'; end if;
 if jsonb_typeof(p_prompts) is distinct from 'array' or jsonb_array_length(p_prompts)<>24 then raise exception 'Expected 24 prompts' using errcode='22023'; end if;
 if (select count(distinct v->>'seedKey') from jsonb_array_elements(p_prompts) v)<>24
 or exists(select 1 from jsonb_array_elements(p_prompts) v group by v->>'circle' having count(*)<>6)
 then raise exception 'Expected unique keys and six per circle' using errcode='22023'; end if;
 for item in select * from jsonb_array_elements(p_prompts) loop
 if item->>'circle' not in ('New Dad Crew','Single Dads','Dad Strength','Every Kind of Dad')
 or coalesce(item->>'seedKey','') !~ '^jamie-2026-11-19:(new-dad-crew|single-dads|dad-strength|every-kind-of-dad):[1-6]$'
 or coalesce(length(btrim(item->>'prompt')),0)=0 or length(item->>'prompt')>2000
 then raise exception 'Invalid prompt entry' using errcode='22023'; end if;
 if split_part(item->>'seedKey',':',2)<>replace(lower(item->>'circle'),' ','-') then raise exception 'Seed circle mismatch' using errcode='22023'; end if;
 select count(*),(array_agg(id))[1] into n,circle from public.circles where lower(btrim(name))=lower(item->>'circle');
 if n<>1 then raise exception 'Circle mapping must resolve exactly once: %',item->>'circle' using errcode='22023'; end if;
 -- An optional expected UUID pins the operator-reviewed production mapping.
 if item ? 'circleId' and (item->>'circleId')::uuid is distinct from circle then raise exception 'Circle mapping changed; review required' using errcode='22023'; end if;
 select * into existing from public.community_prompt_seeds where seed_key=item->>'seedKey';
 action:='create';
 if found then
   if existing.content_sha256 is distinct from sha256(convert_to(item->>'prompt','UTF8'))
   or existing.circle_id is distinct from circle
   or (existing.publisher_id is not null and existing.publisher_id<>p_publisher_id)
   then raise exception 'Existing seed differs; review required' using errcode='22023'; end if;
   if existing.post_id is null or not exists(select 1 from public.posts where id=existing.post_id and removed_at is null) then action:='removed';
   elsif not exists(select 1 from public.posts where id=existing.post_id and content=item->>'prompt' and user_id=p_publisher_id and circle_id=circle and not anonymous)
   then raise exception 'Published seed changed; review required' using errcode='22023';
   else action:='existing'; end if;
 elsif exists(select 1 from public.posts where circle_id=circle and content=item->>'prompt' and removed_at is null) then
   raise exception 'Exact discussion already exists without seed receipt; review required' using errcode='22023';
 end if;
 result:=result||jsonb_build_array(jsonb_build_object('seedKey',item->>'seedKey','publisherId',p_publisher_id,'circleId',circle,'content',item->>'prompt','action',action));
 end loop;
 return result;
end $$;
create function public.import_community_prompts(p_prompts jsonb,p_publisher_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare preview jsonb; item jsonb; new_post uuid;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||p_publisher_id::text,0));
 perform pg_advisory_xact_lock(hashtextextended('community-jamie-seeds',0));
 -- Hold membership/identity stable until all posts and receipts commit together.
 perform 1 from public.community_publishers where user_id=p_publisher_id for share;
 perform 1 from auth.users where id=p_publisher_id for share;
 preview:=public.preview_community_prompt_import(p_prompts,p_publisher_id);
 for item in select * from jsonb_array_elements(preview) loop
   if item->>'action'='create' then
     new_post:=gen_random_uuid();
     insert into public.community_prompt_seeds(seed_key,publisher_id,circle_id,post_id,content_sha256)
     values(item->>'seedKey',p_publisher_id,(item->>'circleId')::uuid,new_post,sha256(convert_to(item->>'content','UTF8')));
     insert into public.posts(id,user_id,circle_id,content,tag,anonymous,author_name,author_initials)
     values(new_post,p_publisher_id,(item->>'circleId')::uuid,item->>'content','general',false,'Dad Health','DH');
   end if;
 end loop;
 return preview;
end $$;
revoke all on function public.preview_community_prompt_import(jsonb,uuid),public.import_community_prompts(jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_community_prompt_import(jsonb,uuid),public.import_community_prompts(jsonb,uuid) to service_role;
commit;
