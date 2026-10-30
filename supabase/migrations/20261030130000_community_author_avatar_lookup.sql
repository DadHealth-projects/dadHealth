begin;

do $$
begin
  if to_regclass('public.user_profile') is null
    or to_regclass('public.posts') is null
    or to_regclass('public.comments') is null then
    raise exception 'Community author avatar prerequisites are missing.';
  end if;
  if to_regprocedure('public.can_read_community_post(uuid)') is null then
    raise exception 'Community post visibility helper is missing.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_profile' and column_name = 'avatar_url'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'posts' and column_name = 'anonymous'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'comments' and column_name = 'anonymous'
  ) then
    raise exception 'Community author avatar columns are missing.';
  end if;
end;
$$;

-- Remove the broader user-ID lookup if an earlier local version was installed.
drop function if exists public.get_community_author_avatars(uuid[]);

-- Resolve only explicitly requested, visible, non-anonymous contributions.
-- The caller cannot use arbitrary user IDs to enumerate profile photos.
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
    and public.can_read_community_post(comment.post_id)
    and nullif(btrim(profile.avatar_url), '') is not null;
$$;

revoke all on function public.get_community_author_avatars(uuid[], uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_community_author_avatars(uuid[], uuid[])
  to authenticated;

comment on function public.get_community_author_avatars(uuid[], uuid[]) is
  'Returns avatar URLs only for explicitly requested visible non-anonymous Community posts/comments.';

commit;
