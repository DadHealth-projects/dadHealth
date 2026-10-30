begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('63000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'avatar-public@example.test', '', now(), now(), now()),
  ('63000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'avatar-anonymous@example.test', '', now(), now(), now()),
  ('63000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'avatar-private@example.test', '', now(), now(), now()),
  ('63000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'avatar-no-photo@example.test', '', now(), now(), now());

insert into public.user_profile(user_id, avatar_url) values
  ('63000000-0000-4000-8000-000000000001', 'https://example.test/public-avatar.jpg'),
  ('63000000-0000-4000-8000-000000000002', 'https://example.test/anonymous-avatar.jpg'),
  ('63000000-0000-4000-8000-000000000003', 'https://example.test/private-avatar.jpg'),
  ('63000000-0000-4000-8000-000000000004', null)
on conflict (user_id) do update set avatar_url = excluded.avatar_url;

insert into public.circles (id, icon, name, members_count, visibility) values
  ('63000000-0000-4000-8000-000000000010', 'community', 'Avatar Private Circle', 0, 'private');

insert into public.posts (id, user_id, circle_id, content, tag, anonymous, author_name) values
  ('63000000-0000-4000-8000-000000000020', '63000000-0000-4000-8000-000000000001', null, 'public avatar post', 'MIND', false, 'Dad'),
  ('63000000-0000-4000-8000-000000000021', '63000000-0000-4000-8000-000000000003', '63000000-0000-4000-8000-000000000010', 'private avatar post', 'BOND', false, 'Dad'),
  ('63000000-0000-4000-8000-000000000022', '63000000-0000-4000-8000-000000000004', null, 'no photo post', 'BODY', false, 'Dad'),
  ('63000000-0000-4000-8000-000000000023', '63000000-0000-4000-8000-000000000002', null, 'separate visible contribution', 'MIND', false, 'Dad');

insert into public.comments (id, user_id, post_id, content, anonymous) values
  ('63000000-0000-4000-8000-000000000024', '63000000-0000-4000-8000-000000000002', '63000000-0000-4000-8000-000000000020', 'anonymous comment', true),
  ('63000000-0000-4000-8000-000000000025', '63000000-0000-4000-8000-000000000003', '63000000-0000-4000-8000-000000000021', 'private circle comment', false);

select ok(has_function_privilege('authenticated', 'public.get_community_author_avatars(uuid[],uuid[])', 'EXECUTE'), 'authenticated users can resolve Community author photos');
select ok(not has_function_privilege('anon', 'public.get_community_author_avatars(uuid[],uuid[])', 'EXECUTE'), 'anonymous database role cannot execute the avatar lookup');

select set_config('request.jwt.claim.sub', '63000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select avatar_url from public.get_community_author_avatars(array['63000000-0000-4000-8000-000000000020'::uuid], '{}'::uuid[])), 'https://example.test/public-avatar.jpg', 'visible non-anonymous post resolves its author's photo by contribution ID');
select is((select count(*)::integer from public.get_community_author_avatars('{}'::uuid[], array['63000000-0000-4000-8000-000000000024'::uuid])), 0, 'anonymous comment never resolves its author's photo, even if that author has another public post');
select is((select count(*)::integer from public.get_community_author_avatars(array['63000000-0000-4000-8000-000000000021'::uuid], '{}'::uuid[])), 0, 'private-circle post photo is hidden from nonmembers');
select is((select count(*)::integer from public.get_community_author_avatars(array['63000000-0000-4000-8000-000000000022'::uuid], '{}'::uuid[])), 0, 'authors without a photo return no avatar row');

insert into public.user_circles(user_id, circle_id)
values ('63000000-0000-4000-8000-000000000001', '63000000-0000-4000-8000-000000000010');
select is((select avatar_url from public.get_community_author_avatars(array['63000000-0000-4000-8000-000000000021'::uuid], '{}'::uuid[])), 'https://example.test/private-avatar.jpg', 'joined members can resolve a visible private-circle post photo');
select is((select avatar_url from public.get_community_author_avatars('{}'::uuid[], array['63000000-0000-4000-8000-000000000025'::uuid])), 'https://example.test/private-avatar.jpg', 'joined members can resolve a visible private-circle comment photo');

select * from finish();
rollback;
