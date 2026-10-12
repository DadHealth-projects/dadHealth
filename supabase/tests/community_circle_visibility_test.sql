begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('61000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'circle-a@example.test', '', now(), now(), now()),
  ('61000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'circle-b@example.test', '', now(), now(), now());

insert into public.circles (id, icon, name, members_count, visibility) values
  ('61000000-0000-4000-8000-000000000010', 'community', 'Public Circle', 1, 'public'),
  ('61000000-0000-4000-8000-000000000011', 'community', 'Private Circle', 1, 'private');
insert into public.user_circles (user_id, circle_id) values
  ('61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000010'),
  ('61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000011');
insert into public.posts (id, user_id, circle_id, content, tag, anonymous, author_name, created_at) values
  ('61000000-0000-4000-8000-000000000020', '61000000-0000-4000-8000-000000000001', null, 'legacy global', 'MIND', false, 'Dad', now() - interval '4 hours'),
  ('61000000-0000-4000-8000-000000000021', '61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000010', 'public post', 'BOND', false, 'Dad', now() - interval '3 hours'),
  ('61000000-0000-4000-8000-000000000022', null, '61000000-0000-4000-8000-000000000011', 'anonymous private post', 'FITNESS', true, 'Anonymous', now() - interval '2 hours');
insert into public.saved_posts (user_id, post_id)
values ('61000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000022');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*)::integer from public.circles), 2, 'Circle directory stays discoverable without exposing private posts');
select is((select count(*)::integer from public.posts where id = '61000000-0000-4000-8000-000000000020'), 1, 'legacy null-Circle post remains globally readable');
select is((select count(*)::integer from public.posts where id = '61000000-0000-4000-8000-000000000021'), 1, 'public Circle post is readable to everyone');
select is((select count(*)::integer from public.posts where id = '61000000-0000-4000-8000-000000000022'), 0, 'private post is hidden from anon');
select is((select count(*)::integer from public.get_community_global_feed(50)), 1, 'main feed keeps global posts and excludes undiscovered public Circle posts');
select is((select count(*)::integer from public.get_trending_circle_posts()), 0, 'main trending previews exclude Circles anon has not joined');

reset role;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select count(*)::integer from public.posts where id = '61000000-0000-4000-8000-000000000022'), 1, 'Circle member reads private post');
select is((select tag from public.posts where id = '61000000-0000-4000-8000-000000000022'), 'FITNESS', 'Circle assignment preserves topic tag');
select is((select count(*)::integer from public.get_community_global_feed(50)), 3, 'main feed includes global posts and posts from both joined Circles');
select is((select count(*)::integer from public.get_trending_circle_posts()), 2, 'main trending previews include joined public and private Circles');
select lives_ok($$insert into public.posts (user_id, circle_id, content, tag, anonymous, author_name) values (null, '61000000-0000-4000-8000-000000000011', 'new anonymous member post', 'MIND', true, 'Anonymous')$$, 'authenticated member can post anonymously to private Circle');
select is((select count(*)::integer from public.anonymous_post_owners where post_id = (select id from public.posts where content = 'new anonymous member post')), 1, 'anonymous ownership record remains captured');
select lives_ok($$insert into public.comments (user_id, post_id, content) values (auth.uid(), '61000000-0000-4000-8000-000000000022', 'private reply')$$, 'member can reply to private post');
select lives_ok($$insert into public.likes (user_id, post_id) values (auth.uid(), '61000000-0000-4000-8000-000000000022')$$, 'member can like private post');
select lives_ok($$insert into public.saved_posts (user_id, post_id) values (auth.uid(), '61000000-0000-4000-8000-000000000022')$$, 'member can save private post');
select is((select count(*)::integer from public.saved_posts where post_id = '61000000-0000-4000-8000-000000000022'), 1, 'private Circle members see only their own saved-post data');
select lives_ok($$insert into public.comment_likes (user_id, comment_id) values (auth.uid(), (select id from public.comments where content = 'private reply'))$$, 'member can like private reply');
select lives_ok($$insert into public.posts (user_id, content, tag, anonymous) values (auth.uid(), 'old client global write', 'BOND', false)$$, 'older client can still create null-Circle global post');
select is((select circle_id from public.posts where content = 'old client global write'), null, 'older client post defaults to global');
select lives_ok($$delete from public.user_circles where user_id = auth.uid() and circle_id = '61000000-0000-4000-8000-000000000011'$$, 'member can leave private Circle');
select is((select count(*)::integer from public.posts where id = '61000000-0000-4000-8000-000000000022'), 0, 'leaving private Circle removes post access immediately');
select is(public.delete_own_community_post((select id from public.posts where content = 'new anonymous member post')), true, 'anonymous owner can still delete own post after leaving');

reset role;
set local role service_role;
select is((select count(*)::integer from public.posts where id = '61000000-0000-4000-8000-000000000022'), 1, 'moderation service role retains access to private Circle posts');
reset role;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is((select count(*)::integer from public.posts where id = '61000000-0000-4000-8000-000000000022'), 0, 'nonmember cannot read private post');
select is((select count(*)::integer from public.comments where post_id = '61000000-0000-4000-8000-000000000022'), 0, 'nonmember cannot read private replies');
select is((select count(*)::integer from public.likes where post_id = '61000000-0000-4000-8000-000000000022'), 0, 'nonmember cannot read private likes');
select is((select count(*)::integer from public.saved_posts where post_id = '61000000-0000-4000-8000-000000000022'), 0, 'nonmember cannot read private saves');
select is((select count(*)::integer from public.comment_likes cl join public.comments c on c.id = cl.comment_id where c.post_id = '61000000-0000-4000-8000-000000000022'), 0, 'nonmember cannot read private comment likes');
select throws_ok($$insert into public.posts (user_id, circle_id, content, tag, anonymous) values (auth.uid(), '61000000-0000-4000-8000-000000000011', 'unauthorized', 'MIND', false)$$, '42501', null, 'nonmember cannot create private Circle post');

reset role;
select * from finish();
rollback;
