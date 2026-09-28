begin;

create extension if not exists pgtap with schema extensions;

select plan(21);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at
)
values
  ('48000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'present-dad-one@example.test', '', now(), now(), now()),
  ('48000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'present-dad-two@example.test', '', now(), now(), now());

select is(public.present_dad_session_counts_toward_score(null), false, 'missing duration does not earn Bond score');
select is(public.present_dad_session_counts_toward_score(300), true, 'exactly five minutes is score eligible');

select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$insert into public.present_dad_sessions (id, user_id, started_at, ends_at)
    values
      ('48000000-0000-4000-8000-000000000011', auth.uid(), '2000-01-01 00:00:00+00', '2000-01-01 00:01:00+00'),
      ('48000000-0000-4000-8000-000000000012', auth.uid(), '2000-01-01 00:00:00+00', '2000-01-01 00:01:00+00'),
      ('48000000-0000-4000-8000-000000000013', auth.uid(), '2000-01-01 00:00:00+00', '2000-01-01 00:01:00+00'),
      ('48000000-0000-4000-8000-000000000014', auth.uid(), '2000-01-01 00:00:00+00', '2000-01-01 00:01:00+00')$$,
  'an authenticated user can start Present Dad sessions'
);

select is(
  (select status from public.present_dad_sessions where id = '48000000-0000-4000-8000-000000000011'),
  'active'::text,
  'a new session starts active'
);
select ok(
  (select started_at > '2020-01-01 00:00:00+00'::timestamptz from public.present_dad_sessions where id = '48000000-0000-4000-8000-000000000011'),
  'the server replaces client-supplied session timing'
);
select is(
  (select ends_at - started_at from public.present_dad_sessions where id = '48000000-0000-4000-8000-000000000011'),
  interval '60 minutes',
  'the server sets a 60-minute duration'
);

reset role;
-- Backdate test sessions without changing the production trigger behavior under
-- test. Re-enable it before invoking the real server completion RPC.
alter table public.present_dad_sessions disable trigger enforce_present_dad_session_timing;
update public.present_dad_sessions
set started_at = statement_timestamp() - interval '240 seconds',
    ends_at = statement_timestamp() - interval '240 seconds' + interval '60 minutes'
where id = '48000000-0000-4000-8000-000000000012';
update public.present_dad_sessions
set started_at = statement_timestamp() - interval '300 seconds',
    ends_at = statement_timestamp() - interval '300 seconds' + interval '60 minutes'
where id = '48000000-0000-4000-8000-000000000013';
update public.present_dad_sessions
set started_at = statement_timestamp() - interval '3600 seconds',
    ends_at = statement_timestamp()
where id = '48000000-0000-4000-8000-000000000014';
alter table public.present_dad_sessions enable trigger enforce_present_dad_session_timing;

select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select lives_ok(
  $$insert into public.present_dad_sessions (id, user_id, started_at, ends_at)
    values ('48000000-0000-4000-8000-000000000021', auth.uid(), now(), now() + interval '1 hour')$$,
  'the second user can start their own session'
);

select set_config('request.jwt.claim.sub', '48000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$select public.finish_present_dad_session('48000000-0000-4000-8000-000000000012')$$,
  'an early session can be ended and saved'
);
select is(
  (select status from public.present_dad_sessions where id = '48000000-0000-4000-8000-000000000012'),
  'cancelled'::text,
  'an under-five-minute session is retained without completion credit'
);
select ok(
  (select completed_duration_seconds between 240 and 299 from public.present_dad_sessions where id = '48000000-0000-4000-8000-000000000012'),
  'the under-five-minute actual duration is persisted'
);
select is(
  public.present_dad_session_counts_toward_score((select completed_duration_seconds from public.present_dad_sessions where id = '48000000-0000-4000-8000-000000000012')),
  false,
  'the under-five-minute session does not count toward Bond score'
);

select lives_ok(
  $$select public.finish_present_dad_session('48000000-0000-4000-8000-000000000013')$$,
  'a session at the five-minute threshold can be completed'
);
select is(
  (select status from public.present_dad_sessions where id = '48000000-0000-4000-8000-000000000013'),
  'completed'::text,
  'a session of at least five minutes receives completed status'
);
select ok(
  (select completed_duration_seconds >= 300 and completed_duration_seconds < 3600 from public.present_dad_sessions where id = '48000000-0000-4000-8000-000000000013'),
  'the valid early completion duration is persisted'
);
select is(
  public.present_dad_session_counts_toward_score((select completed_duration_seconds from public.present_dad_sessions where id = '48000000-0000-4000-8000-000000000013')),
  true,
  'the five-minute session is eligible for canonical Bond scoring'
);

select lives_ok(
  $$select public.finish_present_dad_session('48000000-0000-4000-8000-000000000014')$$,
  'an expired full session can be completed by the server'
);
select is(
  (select status from public.present_dad_sessions where id = '48000000-0000-4000-8000-000000000014'),
  'completed'::text,
  'an expired full session receives completed status'
);
select is(
  (select completed_duration_seconds from public.present_dad_sessions where id = '48000000-0000-4000-8000-000000000014'),
  3600,
  'full-session duration is persisted and capped at 60 minutes'
);
select is(
  public.present_dad_session_counts_toward_score((select completed_duration_seconds from public.present_dad_sessions where id = '48000000-0000-4000-8000-000000000014')),
  true,
  'a valid full session is eligible for canonical Bond scoring'
);

select throws_ok(
  $$select public.finish_present_dad_session('48000000-0000-4000-8000-000000000021')$$,
  'P0002',
  'Present Dad session not found',
  'a user cannot finish another user''s session'
);

reset role;
select throws_ok(
  $$update public.present_dad_sessions set status = 'cancelled' where id = '48000000-0000-4000-8000-000000000013'$$,
  'P0001',
  'Finished Present Dad session results cannot be changed',
  'a finished session cannot be mutated into another result'
);

select * from finish();
rollback;
