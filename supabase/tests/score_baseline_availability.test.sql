begin;

set local timezone = 'UTC';

create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(
  public.is_dad_score_baseline_available('2026-09-28 12:00:00+00', '2026-09-28', '2026-10-05'),
  'Monday signup week can qualify after its Sunday closes'
);
select ok(
  not public.is_dad_score_baseline_available('2026-10-01 12:00:00+00', '2026-09-28', '2026-10-05'),
  'midweek signup does not treat remaining days as a full week'
);
select ok(
  not public.is_dad_score_baseline_available(
    '2026-10-01 12:00:00+00', '2026-09-28', date_trunc('week', '2026-10-11'::date)::date
  ),
  'Sunday still belongs to first full Monday-Sunday baseline week'
);
select ok(
  public.is_dad_score_baseline_available('2026-10-01 12:00:00+00', '2026-09-28', '2026-10-12'),
  'baseline becomes available the following Monday'
);
select ok(
  public.is_dad_score_baseline_available('2020-01-06 12:00:00+00', '2026-09-28', '2026-10-05'),
  'existing user qualifies after one complete effective-model week'
);
select ok(
  not public.is_dad_score_baseline_available('2020-01-06 12:00:00+00', '2026-09-28', '2026-09-28'),
  'Change 07 effective week remains protected from cross-model comparison'
);
select ok(
  not public.is_dad_score_baseline_available(null, '2026-09-28', '2026-09-28'),
  'missing creation date fails closed during effective week'
);
select ok(
  public.is_dad_score_baseline_available(null, '2026-09-28', '2026-10-05'),
  'missing creation date can establish baseline after effective week closes'
);

select * from finish();
rollback;
