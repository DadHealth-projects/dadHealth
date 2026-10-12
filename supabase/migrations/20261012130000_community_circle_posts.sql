-- Add Circle-scoped posts while keeping existing and older-client posts global.
alter table public.circles
  add column if not exists visibility text not null default 'public';

alter table public.circles
  drop constraint if exists circles_visibility_check,
  add constraint circles_visibility_check check (visibility in ('public', 'private'));

alter table public.posts
  add column if not exists circle_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'posts_circle_id_fkey'
      and conrelid = 'public.posts'::regclass
  ) then
    alter table public.posts
      add constraint posts_circle_id_fkey
      foreign key (circle_id) references public.circles(id) on delete restrict;
  end if;
end;
$$;

create index if not exists idx_posts_circle_created_at
  on public.posts(circle_id, created_at desc);

create or replace function public.is_circle_member(p_circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.user_circles uc
    where uc.circle_id = p_circle_id and uc.user_id = auth.uid()
  );
$$;

create or replace function public.can_read_community_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.posts p
    left join public.circles c on c.id = p.circle_id
    where p.id = p_post_id
      and (p.circle_id is null or c.visibility = 'public' or public.is_circle_member(c.id))
  );
$$;

create or replace function public.can_read_community_comment(p_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.comments c
    where c.id = p_comment_id and public.can_read_community_post(c.post_id)
  );
$$;

revoke all on function public.is_circle_member(uuid) from public;
revoke all on function public.can_read_community_post(uuid) from public;
revoke all on function public.can_read_community_comment(uuid) from public;
grant execute on function public.is_circle_member(uuid) to anon, authenticated, service_role;
grant execute on function public.can_read_community_post(uuid) to anon, authenticated, service_role;
grant execute on function public.can_read_community_comment(uuid) to anon, authenticated, service_role;

alter table public.circles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.likes enable row level security;
alter table public.saved_posts enable row level security;
alter table public.user_circles enable row level security;
alter table public.comment_likes enable row level security;

drop policy if exists "Anyone can read circles" on public.circles;
drop policy if exists "Read public circles or joined private circles" on public.circles;
create policy "Anyone can browse Circle directory"
on public.circles for select to anon, authenticated using (true);

drop policy if exists "Allow read posts" on public.posts;
create policy "Read global public and joined Circle posts"
on public.posts for select to anon, authenticated
using (circle_id is null or public.can_read_community_post(id));

drop policy if exists "Auth can insert posts" on public.posts;
create policy "Authenticated users can create global or joined Circle posts"
on public.posts for insert to authenticated
with check (
  auth.uid() is not null
  and (circle_id is null or public.is_circle_member(circle_id))
  and ((anonymous is true and user_id is null) or (anonymous is not true and user_id = auth.uid()))
);

drop policy if exists "Allow read comments" on public.comments;
create policy "Read comments on readable posts"
on public.comments for select to anon, authenticated
using (public.can_read_community_post(post_id));

drop policy if exists "Users can insert own comments" on public.comments;
create policy "Members can comment on readable posts"
on public.comments for insert to authenticated
with check (auth.uid() = user_id and public.can_read_community_post(post_id));

drop policy if exists "Allow read likes" on public.likes;
create policy "Read likes on readable posts"
on public.likes for select to anon, authenticated
using (public.can_read_community_post(post_id));

drop policy if exists "Users can insert own likes" on public.likes;
create policy "Users can like readable posts"
on public.likes for insert to authenticated
with check (auth.uid() = user_id and public.can_read_community_post(post_id));

drop policy if exists "Allow read saved_posts" on public.saved_posts;
create policy "Read saves on readable posts"
on public.saved_posts for select to anon, authenticated
using (auth.uid() = user_id and public.can_read_community_post(post_id));

drop policy if exists "Users can insert own saves" on public.saved_posts;
create policy "Users can save readable posts"
on public.saved_posts for insert to authenticated
with check (auth.uid() = user_id and public.can_read_community_post(post_id));

drop policy if exists "Anyone can read comment likes" on public.comment_likes;
create policy "Read comment likes on readable posts"
on public.comment_likes for select to anon, authenticated
using (public.can_read_community_comment(comment_id));

drop policy if exists "Users can like comments" on public.comment_likes;
create policy "Users can like comments on readable posts"
on public.comment_likes for insert to authenticated
with check (auth.uid() = user_id and public.can_read_community_comment(comment_id));

drop policy if exists "Users can CRUD own user_circles" on public.user_circles;
create policy "Users can read own Circle memberships"
on public.user_circles for select to authenticated using (auth.uid() = user_id);
create policy "Users can join Circles as themselves"
on public.user_circles for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can leave Circles"
on public.user_circles for delete to authenticated using (auth.uid() = user_id);

create table if not exists public.circle_prompts (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references public.circles(id) on delete cascade not null,
  prompt text not null,
  is_official boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists circle_prompts_circle_id_idx on public.circle_prompts(circle_id);
alter table public.circle_prompts enable row level security;

drop policy if exists "Anyone can read circle prompts" on public.circle_prompts;
create policy "Read prompts for public or joined Circles"
on public.circle_prompts for select to anon, authenticated
using (
  exists (
    select 1 from public.circles c
    where c.id = circle_prompts.circle_id
      and (c.visibility = 'public' or public.is_circle_member(c.id))
  )
);

create or replace function public.trending_post_tags(limit_n int default 5)
returns table(tag text, count bigint)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select p.tag, count(*)::bigint
  from public.posts p
  left join public.circles c on c.id = p.circle_id
  where p.circle_id is null or public.is_circle_member(p.circle_id)
  group by p.tag
  order by count(*) desc, p.tag
  limit greatest(1, coalesce(limit_n, 5));
$$;

revoke all on function public.trending_post_tags(int) from public;
grant execute on function public.trending_post_tags(int) to anon, authenticated;

-- Main feed keeps legacy global posts and posts from the user's joined Circles.
create or replace function public.get_community_global_feed(p_limit integer default 50)
returns setof public.posts
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select p.*
  from public.posts p
  left join public.circles c on c.id = p.circle_id
  where p.circle_id is null or public.is_circle_member(p.circle_id)
  order by p.created_at desc, p.id
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.get_community_global_feed(integer) from public;
grant execute on function public.get_community_global_feed(integer) to anon, authenticated;

-- Deterministic 7-day trend: one post per joined Circle, ranked by 2 points per like and 3 per reply.
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
    select p.id, p.circle_id, c.name as circle_name, p.content, p.tag,
      p.anonymous, p.author_initials, p.author_name, p.created_at,
      count(distinct l.id)::bigint as likes_count,
      count(distinct cm.id)::bigint as replies_count
    from public.posts p
    join public.circles c on c.id = p.circle_id
    left join public.likes l on l.post_id = p.id
    left join public.comments cm on cm.post_id = p.id
    where p.created_at >= now() - interval '7 days'
      and public.is_circle_member(c.id)
    group by p.id, p.circle_id, c.name, p.content, p.tag, p.anonymous,
      p.author_initials, p.author_name, p.created_at
  ), ranked as (
    select e.*, row_number() over (
      partition by e.circle_id
      order by (e.likes_count * 2 + e.replies_count * 3) desc, e.created_at desc, e.id
    ) as position
    from engagement e
  )
  select r.circle_id, r.circle_name, r.id, r.content, r.tag, r.anonymous,
    r.author_initials, r.author_name, r.created_at, r.likes_count, r.replies_count
  from ranked r where r.position = 1
  order by r.circle_name;
$$;

revoke all on function public.get_trending_circle_posts() from public;
grant execute on function public.get_trending_circle_posts() to anon, authenticated;

comment on column public.posts.circle_id is
  'Circle for a Circle-scoped post. NULL preserves legacy global posts and older-client writes.';
comment on column public.circles.visibility is
  'Public Circles are readable by everyone; private Circle content requires membership.';
