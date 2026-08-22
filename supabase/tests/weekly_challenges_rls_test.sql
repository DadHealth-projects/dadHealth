begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
)
values
  (
    '40000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'weekly-one@example.test',
    '',
    now(),
    now(),
    now()
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'weekly-two@example.test',
    '',
    now(),
    now(),
    now()
  );

insert into public.weekly_challenges (
  id,
  title,
  description,
  participants_count,
  active,
  created_at
)
values
  (
    '40000000-0000-4000-8000-000000000010',
    'Active challenge',
    'Complete the active challenge.',
    0,
    true,
    now()
  ),
  (
    '40000000-0000-4000-8000-000000000011',
    'Next challenge',
    'Complete the next challenge.',
    0,
    false,
    now() + interval '1 minute'
  );

select has_table(
  'public',
  'weekly_challenge_participants',
  'weekly challenge participation is persisted'
);

select has_column(
  'public',
  'weekly_challenge_participants',
  'completed_at',
  'weekly challenge completion is persisted'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.weekly_challenges'::regclass),
  'weekly_challenges has row level security enabled'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.weekly_challenge_participants'::regclass),
  'weekly_challenge_participants has row level security enabled'
);

set local role anon;

select is(
  (select count(*)::integer from public.weekly_challenges),
  1,
  'anonymous clients see only the active challenge'
);

select throws_ok(
  $$insert into public.weekly_challenge_participants (challenge_id, user_id) values ('40000000-0000-4000-8000-000000000010', '40000000-0000-4000-8000-000000000001')$$,
  '42501',
  'permission denied for table weekly_challenge_participants',
  'anonymous clients cannot join a challenge'
);

reset role;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  (select count(*)::integer from public.weekly_challenges),
  1,
  'authenticated clients see only the active challenge'
);

select lives_ok(
  $$insert into public.weekly_challenge_participants (challenge_id, user_id) values ('40000000-0000-4000-8000-000000000010', '40000000-0000-4000-8000-000000000001')$$,
  'a user can join the active challenge'
);

select is(
  (select participants_count from public.weekly_challenges where id = '40000000-0000-4000-8000-000000000010'),
  1,
  'joining increments the participant count'
);

select throws_ok(
  $$insert into public.weekly_challenge_participants (challenge_id, user_id) values ('40000000-0000-4000-8000-000000000010', '40000000-0000-4000-8000-000000000001')$$,
  '23505',
  'duplicate key value violates unique constraint "weekly_challenge_participants_pkey"',
  'the same user cannot join the same challenge twice'
);

select throws_ok(
  $$insert into public.weekly_challenge_participants (challenge_id, user_id, completed_at) values ('40000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000001', now())$$,
  '42501',
  null,
  'clients cannot set completion while joining'
);

select throws_ok(
  $$update public.weekly_challenge_participants set completed_at = now() where challenge_id = '40000000-0000-4000-8000-000000000010'$$,
  '42501',
  'permission denied for table weekly_challenge_participants',
  'clients cannot update completion directly'
);

select ok(
  public.complete_weekly_challenge('40000000-0000-4000-8000-000000000010') is not null,
  'a joined user can complete the active challenge'
);

select is(
  (select participants_count from public.weekly_challenges where id = '40000000-0000-4000-8000-000000000010'),
  1,
  'completion does not change the participant count'
);

select is(
  public.complete_weekly_challenge('40000000-0000-4000-8000-000000000010'),
  (select completed_at from public.weekly_challenge_participants where challenge_id = '40000000-0000-4000-8000-000000000010' and user_id = '40000000-0000-4000-8000-000000000001'),
  'duplicate completion returns the original completion timestamp'
);

select is(
  (
    with deleted as (
      delete from public.weekly_challenge_participants
      where challenge_id = '40000000-0000-4000-8000-000000000010'
        and user_id = '40000000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::integer from deleted
  ),
  0,
  'completed participation cannot be removed'
);

select throws_ok(
  $$select * from public.set_active_weekly_challenge('40000000-0000-4000-8000-000000000011', true)$$,
  '42501',
  null,
  'authenticated clients cannot execute the activation RPC'
);

reset role;
set local role service_role;

select lives_ok(
  $$select * from public.set_active_weekly_challenge('40000000-0000-4000-8000-000000000011', true)$$,
  'the service role can activate the next challenge'
);

select is(
  (select count(*)::integer from public.weekly_challenges where active is true),
  1,
  'the activation RPC leaves exactly one active challenge'
);

select is(
  (select count(*)::integer from public.weekly_challenge_participants where challenge_id = '40000000-0000-4000-8000-000000000010'),
  1,
  'activating a new challenge preserves old participation history'
);

select ok(
  (select completed_at is not null from public.weekly_challenge_participants where challenge_id = '40000000-0000-4000-8000-000000000010' and user_id = '40000000-0000-4000-8000-000000000001'),
  'activating a new challenge preserves old completion history'
);

reset role;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$insert into public.weekly_challenge_participants (challenge_id, user_id) values ('40000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000001')$$,
  'the same user can join a new weekly challenge independently'
);

select is(
  (select participants_count from public.weekly_challenges where id = '40000000-0000-4000-8000-000000000011'),
  1,
  'the new challenge has its own accurate participant count'
);

select lives_ok(
  $$delete from public.weekly_challenge_participants where challenge_id = '40000000-0000-4000-8000-000000000011' and user_id = '40000000-0000-4000-8000-000000000001'$$,
  'an incomplete participant can leave the active challenge'
);

select is(
  (select participants_count from public.weekly_challenges where id = '40000000-0000-4000-8000-000000000011'),
  0,
  'leaving decrements the participant count'
);

select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$insert into public.weekly_challenge_participants (challenge_id, user_id) values ('40000000-0000-4000-8000-000000000010', '40000000-0000-4000-8000-000000000002')$$,
  '42501',
  null,
  'users cannot join an inactive historical challenge'
);

select throws_ok(
  $$select public.complete_weekly_challenge('40000000-0000-4000-8000-000000000010')$$,
  'P0001',
  'challenge_not_joined',
  'users cannot complete another user''s participation'
);

select * from finish();
rollback;
