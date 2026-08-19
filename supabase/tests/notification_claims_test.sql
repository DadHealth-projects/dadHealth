begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'notification-event-claims@example.invalid',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '10000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'notification-scheduled-claims@example.invalid',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

create temporary table notification_claim_test_state (
  name text primary key,
  claim_id uuid
) on commit drop;

insert into notification_claim_test_state (name, claim_id)
values (
  'comment_a',
  public.claim_notification_delivery(
    '10000000-0000-0000-0000-000000000001',
    'community_reply',
    'UTC',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  )
);

select isnt(
  (select claim_id from notification_claim_test_state where name = 'comment_a'),
  null::uuid,
  'comment A receives a delivery claim'
);

select ok(
  public.complete_notification_delivery(
    (select claim_id from notification_claim_test_state where name = 'comment_a'),
    'provider-comment-a'
  ),
  'comment A claim completes'
);

insert into notification_claim_test_state (name, claim_id)
values (
  'comment_b',
  public.claim_notification_delivery(
    '10000000-0000-0000-0000-000000000001',
    'community_reply',
    'UTC',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  )
);

select isnt(
  (select claim_id from notification_claim_test_state where name = 'comment_b'),
  null::uuid,
  'comment B on the same day receives a delivery claim'
);

select isnt(
  (select claim_id from notification_claim_test_state where name = 'comment_b'),
  (select claim_id from notification_claim_test_state where name = 'comment_a'),
  'different comments receive different claims'
);

select ok(
  public.complete_notification_delivery(
    (select claim_id from notification_claim_test_state where name = 'comment_b'),
    'provider-comment-b'
  ),
  'comment B claim completes'
);

select is(
  public.claim_notification_delivery(
    '10000000-0000-0000-0000-000000000001',
    'community_reply',
    'UTC',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  ),
  null::uuid,
  'a completed retry of comment A is skipped as a duplicate'
);

insert into notification_claim_test_state (name, claim_id)
values (
  'comment_c',
  public.claim_notification_delivery(
    '10000000-0000-0000-0000-000000000001',
    'community_reply',
    'UTC',
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  )
);

select isnt(
  (select claim_id from notification_claim_test_state where name = 'comment_c'),
  null::uuid,
  'a third eligible notification receives the final daily slot'
);

select is(
  public.claim_notification_delivery(
    '10000000-0000-0000-0000-000000000001',
    'community_reply',
    'UTC',
    'cccccccc-cccc-cccc-cccc-cccccccccccc'
  ),
  (select claim_id from notification_claim_test_state where name = 'comment_c'),
  'an incomplete retry receives the original claim ID'
);

select is(
  public.claim_notification_delivery(
    '10000000-0000-0000-0000-000000000001',
    'community_reply',
    'UTC',
    'dddddddd-dddd-dddd-dddd-dddddddddddd'
  ),
  null::uuid,
  'a fourth eligible notification is skipped by the daily cap'
);

insert into notification_claim_test_state (name, claim_id)
values (
  'scheduled',
  public.claim_notification_delivery(
    '10000000-0000-0000-0000-000000000002',
    'morning_checkin',
    'UTC'
  )
);

select isnt(
  (select claim_id from notification_claim_test_state where name = 'scheduled'),
  null::uuid,
  'the backward-compatible scheduled wrapper creates a claim'
);

select ok(
  public.complete_notification_delivery(
    (select claim_id from notification_claim_test_state where name = 'scheduled'),
    'provider-scheduled'
  ),
  'the scheduled claim completes'
);

select is(
  public.claim_notification_delivery(
    '10000000-0000-0000-0000-000000000002',
    'morning_checkin',
    'UTC'
  ),
  null::uuid,
  'the scheduled wrapper does not duplicate its notification period'
);

select * from finish();
rollback;
