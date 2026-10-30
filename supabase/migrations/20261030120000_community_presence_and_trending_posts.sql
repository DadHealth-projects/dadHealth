begin;

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise exception 'Realtime messages table is unavailable; verify Supabase Realtime prerequisites.';
  end if;
  if not exists (
    select 1
    from pg_class relation
    where relation.oid = 'realtime.messages'::regclass
      and relation.relrowsecurity
  ) then
    raise exception 'Realtime messages row-level security must already be enabled.';
  end if;
  if to_regprocedure('realtime.topic()') is null then
    raise exception 'Realtime topic helper is unavailable; verify Supabase Realtime prerequisites.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'realtime' and table_name = 'messages' and column_name = 'extension'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'realtime' and table_name = 'messages' and column_name = 'topic'
  ) then
    raise exception 'Realtime message authorization columns are unavailable.';
  end if;
end;
$$;

-- Scope authorization to this private Presence topic. Restrictive guards make
-- broader existing Realtime policies unable to grant anonymous Presence access
-- to this topic; policies for other topics and extensions keep their behavior.
drop policy if exists "Community Presence auth guard select" on realtime.messages;
create policy "Community Presence auth guard select"
on realtime.messages as restrictive for select to public
using (
  extension <> 'presence'
  or realtime.topic() <> 'community:presence:v1'
  or auth.uid() is not null
);

drop policy if exists "Community Presence auth guard insert" on realtime.messages;
create policy "Community Presence auth guard insert"
on realtime.messages as restrictive for insert to public
with check (
  extension <> 'presence'
  or realtime.topic() <> 'community:presence:v1'
  or auth.uid() is not null
);

drop policy if exists "Authenticated users can read Community Presence" on realtime.messages;
create policy "Authenticated users can read Community Presence"
on realtime.messages for select to authenticated
using (
  extension = 'presence'
  and realtime.topic() = 'community:presence:v1'
  and auth.uid() is not null
);

drop policy if exists "Authenticated users can track Community Presence" on realtime.messages;
create policy "Authenticated users can track Community Presence"
on realtime.messages for insert to authenticated
with check (
  extension = 'presence'
  and realtime.topic() = 'community:presence:v1'
  and auth.uid() is not null
);

-- Keep the existing security-invoker contract and response columns.
create or replace function public.get_trending_circle_posts()
returns table(
  circle_id uuid,
  circle_name text,
  post_id uuid,
  content text,
  tag text,
  anonymous boolean,
  author_initials text,
  author_name text,
  created_at timestamptz,
  likes_count bigint,
  replies_count bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with engagement as (
    select
      post.id,
      post.circle_id,
      circle.name as circle_name,
      post.content,
      post.tag,
      post.anonymous,
      post.author_initials,
      post.author_name,
      post.created_at,
      count(distinct post_like.id)::bigint as likes_count,
      count(distinct comment.id)::bigint as replies_count
    from public.posts post
    join public.circles circle on circle.id = post.circle_id
    left join public.likes post_like on post_like.post_id = post.id
    left join public.comments comment on comment.post_id = post.id
    where post.created_at >= now() - interval '7 days'
      and public.is_circle_member(circle.id)
    group by
      post.id,
      post.circle_id,
      circle.name,
      post.content,
      post.tag,
      post.anonymous,
      post.author_initials,
      post.author_name,
      post.created_at
  )
  select
    engagement.circle_id,
    engagement.circle_name,
    engagement.id,
    engagement.content,
    engagement.tag,
    engagement.anonymous,
    engagement.author_initials,
    engagement.author_name,
    engagement.created_at,
    engagement.likes_count,
    engagement.replies_count
  from engagement
  order by
    engagement.likes_count + engagement.replies_count desc,
    engagement.created_at desc,
    engagement.id
  limit 4;
$$;

revoke all on function public.get_trending_circle_posts() from public;
grant execute on function public.get_trending_circle_posts() to anon, authenticated;

commit;
