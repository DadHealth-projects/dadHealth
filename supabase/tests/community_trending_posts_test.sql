begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('62000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trend-a@example.test', '', now(), now(), now()),
  ('62000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trend-b@example.test', '', now(), now(), now());

insert into public.circles (id, icon, name, members_count, visibility) values
  ('62000000-0000-4000-8000-000000000010', 'community', 'Trending Public', 1, 'public'),
  ('62000000-0000-4000-8000-000000000011', 'community', 'Trending Private', 0, 'private');
insert into public.user_circles (user_id, circle_id)
values ('62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000010');

insert into public.posts (id, user_id, circle_id, content, tag, anonymous, author_name, created_at) values
  ('62000000-0000-4000-8000-000000000020', '62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000010', 'older tie', 'MIND', false, 'Dad', now() - interval '2 hours'),
  ('62000000-0000-4000-8000-000000000021', '62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000010', 'newer tie', 'MIND', false, 'Dad', now() - interval '1 hour'),
  ('62000000-0000-4000-8000-000000000022', '62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000010', 'third place', 'BOND', false, 'Dad', now() - interval '30 minutes'),
  ('62000000-0000-4000-8000-000000000023', '62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000010', 'fourth place', 'BODY', false, 'Dad', now() - interval '20 minutes'),
  ('62000000-0000-4000-8000-000000000024', '62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000010', 'fifth place', 'BODY', false, 'Dad', now() - interval '10 minutes'),
  ('62000000-0000-4000-8000-000000000025', '62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000010', 'sixth place', 'BODY', false, 'Dad', now() - interval '5 minutes'),
  ('62000000-0000-4000-8000-000000000026', null, '62000000-0000-4000-8000-000000000011', 'private high engagement', 'MIND', true, 'Anonymous', now() - interval '3 minutes'),
  ('62000000-0000-4000-8000-000000000027', '62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000010', 'outside week', 'BODY', false, 'Dad', now() - interval '8 days');

insert into public.likes (user_id, post_id) values
  ('62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000020'),
  ('62000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000020'),
  ('62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000021'),
  ('62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000022'),
  ('62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000023'),
  ('62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000026');

insert into public.comments (user_id, post_id, content) values
  ('62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000020', 'one reply'),
  ('62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000021', 'first reply'),
  ('62000000-0000-4000-8000-000000000002', '62000000-0000-4000-8000-000000000021', 'second reply'),
  ('62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000022', 'one reply'),
  ('62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000026', 'private reply'),
  ('62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000027', 'old reply');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::integer from public.get_trending_circle_posts()), 0, 'anonymous users see no joined Circle trending posts');

reset role;
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select count(*)::integer from public.get_trending_circle_posts()), 4, 'trending function returns no more than four eligible posts');
select is(
  (select array_agg(trend.post_id order by trend.ordinality)
   from public.get_trending_circle_posts() with ordinality as trend(circle_id, circle_name, post_id, content, tag, anonymous, author_initials, author_name, created_at, likes_count, replies_count, ordinality)),
  array['62000000-0000-4000-8000-000000000021'::uuid, '62000000-0000-4000-8000-000000000020'::uuid, '62000000-0000-4000-8000-000000000022'::uuid, '62000000-0000-4000-8000-000000000023'::uuid],
  'posts rank by likes plus comments, then newest first'
);
select is((select likes_count + replies_count from public.get_trending_circle_posts() where post_id = '62000000-0000-4000-8000-000000000020'), 3::bigint, 'engagement count includes likes and comments once each');
select is((select count(*)::integer from public.get_trending_circle_posts() where post_id = '62000000-0000-4000-8000-000000000026'), 0, 'private Circle post stays hidden from nonmembers');
select is((select count(*)::integer from public.get_trending_circle_posts() where post_id = '62000000-0000-4000-8000-000000000027'), 0, 'posts older than seven days stay outside the trend window');

reset role;
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is((select count(*)::integer from public.get_trending_circle_posts()), 0, 'another authenticated user sees only their joined Circle posts');

reset role;
select is((select count(*)::integer from public.posts where id in (
  '62000000-0000-4000-8000-000000000020', '62000000-0000-4000-8000-000000000021',
  '62000000-0000-4000-8000-000000000022', '62000000-0000-4000-8000-000000000023',
  '62000000-0000-4000-8000-000000000024', '62000000-0000-4000-8000-000000000025',
  '62000000-0000-4000-8000-000000000026', '62000000-0000-4000-8000-000000000027'
)), 8, 'ranking leaves all source posts intact');

select * from finish();
rollback;
