// Phase 1 scoring verification on the LIVE production scoring functions (all four copied
// verbatim and fingerprint-matched 2026-11-26). Synthetic accounts only. Nothing here changes
// the agreed formulas; only helpers outside the scoring path are stubbed.
import { readFileSync } from 'node:fs';
import { fresh, as, check, done, attempt, A, B } from './common.mjs';

const WEEK = '2026-11-23';
const db = await fresh();
await db.exec(`
  create table public.mind_score_model_config(model_version text primary key, effective_week_start date, activity_target numeric);
  create table public.body_bond_score_model_config(model_version text primary key, effective_week_start date);
  create table public.dad_score_model_config(model_version text primary key, effective_week_start date, manual_weight numeric, mind_checkin_weight numeric, checkin_weight numeric, other_weight numeric);
  insert into public.mind_score_model_config values ('mind_70_30_v2','2026-11-23',28);
  insert into public.body_bond_score_model_config values ('body_bond_70_30_v3','2026-11-23');
  insert into public.dad_score_model_config values ('60_40_10_30_v1','2026-10-19',60,40,10,30);
  create table public.user_profile(user_id uuid primary key, manual_pro_grant boolean default false);
  insert into public.user_profile values ('${A}', false), ('${B}', true);  -- A Free, B Pro (C: trial, added below)
  create table public.mood_logs(id uuid default gen_random_uuid() primary key, user_id uuid, date date, mood_value int,
    mood_scale_version int default 2, stress_level int, energy_level int, connection_level int, unique(user_id, date));
  create table public.activity_logs(id uuid default gen_random_uuid() primary key, user_id uuid, activity_date date, pillar text,
    activity_type text, category text, intensity text, duration_minutes int, logged_at timestamptz default now(),
    client_request_id uuid default gen_random_uuid(), unique(user_id, client_request_id));
  create table public.workout_sessions(id uuid default gen_random_uuid() primary key, user_id uuid, performed_at timestamptz);
  create table public.sleep_logs(id uuid default gen_random_uuid() primary key, user_id uuid, date date, hours numeric, unique(user_id, date));
  create table public.body_metrics(id uuid default gen_random_uuid() primary key, user_id uuid, metric_type text, value numeric, recorded_at timestamptz);
  create table public.journal_entries(id uuid default gen_random_uuid() primary key, user_id uuid, created_at timestamptz, scoring_date date);
  create table public.bond_logs(id uuid default gen_random_uuid() primary key, user_id uuid, quality int, created_at timestamptz, activity_type text);
  create table public.co_parenting_schedules(user_id uuid, custody_dates date[]);
  create table public.present_dad_sessions(id uuid default gen_random_uuid() primary key, user_id uuid, status text, completed_at timestamptz);
  create table public.mind_reset_sessions(id uuid primary key, user_id uuid, activity_date date);
  create function public.scoring_week_boundary(uuid, date) returns timestamptz language sql as $$ select $2::timestamptz $$;
  create function public.scoring_timezone_at(uuid, timestamptz) returns text language sql as $$ select 'UTC'::text $$;
  create function public.calculate_dad_score_period_pre_phase2(uuid, date, date, timestamptz, timestamptz)
    returns table(mind_score numeric, body_score numeric, bond_score numeric, mind_has_data boolean, body_has_data boolean, bond_has_data boolean)
    language sql as $$ select -1::numeric, -1::numeric, -1::numeric, false, false, false $$;
`);
await db.exec(readFileSync(new URL('./live_scoring_sources.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('./live_scoring_functions.sql', import.meta.url), 'utf8'));
// Production since 26 Nov = these sources + migration 20261126100000 (step 09, verified live).
// LEGACY=1 reproduces the pre-09 defect for comparison.
if (process.env.LEGACY !== '1') await db.exec(readFileSync(new URL('../../../supabase/migrations/20261126100000_m3_body_missing_data_points.sql', import.meta.url), 'utf8'));
console.log(process.env.LEGACY === '1' ? 'MODE: pre-step-09 (legacy defect)' : 'MODE: production as live since 26 Nov (step 09 applied)');
await db.exec(`grant execute on all functions in schema public to authenticated;`);

const n = (v) => Number(v);
const near = (a, b) => Math.abs(n(a) - b) < 1e-9;
async function score(user = A, week = WEEK) {
  await as(db, 'postgres');
  return (await db.query(`select * from public.calculate_dad_score_period('${user}', '${week}', '${week}'::date + 7, '${week}', '${week}'::date + 7)`)).rows[0];
}
const reset = () => db.exec(`truncate public.mood_logs, public.activity_logs, public.workout_sessions, public.sleep_logs, public.body_metrics,
  public.journal_entries, public.bond_logs, public.present_dad_sessions, public.mind_reset_sessions, public.co_parenting_schedules;`);
const checkins = (user, days, week = WEEK) => db.exec(`insert into public.mood_logs(user_id,date,mood_value,energy_level,connection_level)
  select '${user}', '${week}'::date + d, 3, 4, 4 from generate_series(0, ${days - 1}) d`);
const resets = (user, days, perDay = 1) => db.exec(`insert into public.mind_reset_sessions
  select gen_random_uuid(), '${user}', '${WEEK}'::date + d from generate_series(0, ${days - 1}) d, generate_series(1, ${perDay})`);
const manualBody = (user, days, perDay = 1) => db.exec(`insert into public.activity_logs(user_id,activity_date,pillar,activity_type,intensity,duration_minutes)
  select '${user}', '${WEEK}'::date + d, 'body', 'workout', 'moderate', 60 from generate_series(0, ${days - 1}) d, generate_series(1, ${perDay})`);

// 1. Free and Pro: identical inputs give identical scores (scoring never reads entitlement).
await reset();
for (const u of [A, B]) { await checkins(u, 7); await resets(u, 7); await manualBody(u, 4); }
let a = await score(A), b = await score(B);
check('Free and Pro reach 100 on Mind and Body with the same activity', n(a.mind_score) === 100 && n(b.mind_score) === 100 && n(a.body_score) === 100 && n(b.body_score) === 100, JSON.stringify({ a, b }));
const sources = readFileSync(new URL('./live_scoring_sources.sql', import.meta.url), 'utf8') + readFileSync(new URL('./live_scoring_functions.sql', import.meta.url), 'utf8');
check('scoring functions contain no Free/Pro branch', !/user_has_pro_access|manual_pro_grant|subscription_entitlements|is_pro/.test(sources));

// 2. Mind: daily caps and duplicates.
await reset(); await checkins(A, 7); await resets(A, 7, 3);
check('Mind: three Mind Resets on one day count once (4 points/day), so 7 days reach 100', n((await score()).mind_score) === 100);
await reset(); await checkins(A, 7); await resets(A, 3, 5);
check('Mind: 15 resets over 3 days give 12 activity points, not 60', near((await score()).mind_score, 70 + 30 * 12 / 28));
await reset(); await checkins(A, 7); await resets(A, 7);
await db.exec(`insert into public.journal_entries(user_id, created_at) select '${A}', ('${WEEK}'::date + d)::timestamptz + interval '9 hours' from generate_series(0,6) d`);
check('Mind: a journal entry and a Mind Reset on the same day count once', n((await score()).mind_score) === 100);
await reset(); await checkins(A, 6); await resets(A, 7);
check('Mind: 6 check-in days cap at 90 even with full activity', n((await score()).mind_score) === 90);

// 3. Body: manual one-winner-per-day, imports, combination, 30-point pool.
await reset(); await checkins(A, 7); await manualBody(A, 1, 6);
check('Body: six manual workouts on one day count once', near((await score()).body_score, 70 + 30 * 8 / 28));
await reset(); await checkins(A, 7);
await db.exec(`insert into public.sleep_logs(user_id,date,hours) select '${A}', '${WEEK}'::date + d, 8 from generate_series(0,6) d;
  insert into public.body_metrics(user_id,metric_type,value,recorded_at) select '${A}', 'steps', 10000, ('${WEEK}'::date + d)::timestamptz + interval '20 hours' from generate_series(0,6) d;
  insert into public.body_metrics(user_id,metric_type,value,recorded_at) select '${A}', 'active_mins', 30, ('${WEEK}'::date + d)::timestamptz + interval '20 hours' from generate_series(0,6) d;
  insert into public.workout_sessions(user_id, performed_at) select '${A}', ('${WEEK}'::date + d)::timestamptz + interval '7 hours' from generate_series(0,4) d;`);
check('Body: imported sleep, steps, active minutes and 5 workouts fill the pool, so 100 with 7 check-ins', n((await score()).body_score) === 100, JSON.stringify(await score()));
await reset(); await checkins(A, 7); await manualBody(A, 2);
await db.exec(`insert into public.workout_sessions(user_id, performed_at) select '${A}', ('${WEEK}'::date + d)::timestamptz + interval '7 hours' from generate_series(0,2) d`);
check('Body: manual and imported sources combine (16/28 + 24/100 of the pool)', near((await score()).body_score, 70 + 30 * (16 / 28 + 0.24)));
await reset(); await checkins(A, 7); await manualBody(A, 7); await db.exec(`insert into public.workout_sessions(user_id, performed_at) select '${A}', '${WEEK}'::timestamptz + interval '7 hours' from generate_series(1,20)`);
check('Body: never above 100', n((await score()).body_score) === 100);

// 4. Bond.
await reset(); await checkins(A, 7);
await db.exec(`insert into public.journal_entries(user_id, created_at) select '${A}', ('${WEEK}'::date + d)::timestamptz + interval '9 hours' from generate_series(0,6) d`);
check('Bond: 7 check-ins and 7 journal entries reach 100 (agreed other-source rule)', n((await score()).bond_score) === 100, JSON.stringify(await score()));
await reset(); await checkins(A, 7);
await db.exec(`insert into public.present_dad_sessions(user_id,status,completed_at) values ('${A}','completed','${WEEK} 18:00'), ('${A}','cancelled','${WEEK} 19:00')`);
check('Bond: only completed Present Dad sessions count (1 x 15 of the pool)', near((await score()).bond_score, 70 + 30 * 0.15));

// 4b. Missing imported data must award nothing (defect found 2026-11-26).
await reset(); await checkins(A, 7);
check('Body: 7 check-ins and no activity or imported data = exactly 70', n((await score()).body_score) === 70, JSON.stringify(await score()));
await db.exec(`insert into public.body_metrics(user_id,metric_type,value,recorded_at) select '${A}', 'steps', 10000, ('${WEEK}'::date + d)::timestamptz + interval '20 hours' from generate_series(0,6) d`);
check('Body: steps only adds the steps share (20/100 of the pool), nothing for missing sleep or active minutes', near((await score()).body_score, 70 + 30 * 0.2), JSON.stringify(await score()));
await reset(); await checkins(A, 1);
check('day one: one check-in gives Body 10, not 28', n((await score()).body_score) === 10, JSON.stringify(await score()));

// 5. Duplicate submissions blocked at the database.
await reset();
await checkins(A, 1);
check('the same-day check-in is rejected (unique per account day)', Boolean(await attempt(db, `insert into public.mood_logs(user_id,date,mood_value) values ('${A}','${WEEK}',3)`)));
const rid = '00000000-0000-4000-8000-0000000000aa';
await db.exec(`insert into public.activity_logs(user_id,activity_date,pillar,activity_type,intensity,duration_minutes,client_request_id) values ('${A}','${WEEK}','body','workout','hard',60,'${rid}')`);
check('a retried manual activity with the same request id is rejected', Boolean(await attempt(db,
  `insert into public.activity_logs(user_id,activity_date,pillar,activity_type,intensity,duration_minutes,client_request_id) values ('${A}','${WEEK}','body','workout','hard',60,'${rid}')`)));
await reset(); await checkins(A, 7);
await db.exec(`insert into public.workout_sessions(user_id, performed_at) values ('${A}','${WEEK} 07:00'), ('${A}','${WEEK} 07:00')`);
check('KNOWN GAP (fixed in the app): two rows for one in-app workout both count (+8 each)', near((await score()).body_score, 70 + 30 * 0.16));

// 6. Account isolation.
await reset(); await checkins(A, 7); await resets(A, 7); await checkins(B, 1);
check("B's score is unaffected by A's data", n((await score(B)).mind_score) === 10, JSON.stringify(await score(B)));
await as(db, 'authenticated', A);
const err = await attempt(db, `select * from public.calculate_dad_score_period('${B}', '${WEEK}', '${WEEK}'::date + 7, '${WEEK}', '${WEEK}'::date + 7)`);
check('a signed-in member cannot read another account score', /score_user_mismatch/.test(err ?? ''), String(err));
await as(db, 'postgres');

// 7. Missing data and new vs existing members.
await reset();
const empty = await score(A);
check('a brand-new member has no data flags (shown as "—", not 0)', !empty.mind_has_data && !empty.body_has_data && !empty.bond_has_data, JSON.stringify(empty));
await checkins(A, 7, '2026-11-16'); await checkins(A, 2);
check("an existing member's earlier week does not count in this week", n((await score(A)).mind_score) === 20);
check('weeks before the 23 Nov model start use the earlier formula', n((await score(A, '2026-11-16')).mind_score) === -1);

// 8. Client audit A1 additions (26 Nov).
const C = '00000000-0000-4000-8000-00000000000c';
await db.exec(`insert into auth.users(id) values ('${C}'); insert into public.user_profile values ('${C}', false);`);
await reset();
for (const u of [A, B, C]) { await checkins(u, 7); await resets(u, 7); await manualBody(u, 4); }
const [fa, fb, fc] = [await score(A), await score(B), await score(C)];
check('Free, Pro and trial members score identically for identical activity (all 100)', [fa, fb, fc].every((x) => n(x.mind_score) === 100 && n(x.body_score) === 100), JSON.stringify({ fa, fb, fc }));
await reset(); await checkins(A, 7);
await db.exec(`insert into public.activity_logs(user_id,activity_date,pillar,activity_type,intensity,duration_minutes) values
  ('${A}','${WEEK}','body','walk','light',20), ('${A}','${WEEK}','body','run','hard',60), ('${A}','${WEEK}','body','yoga','moderate',30)`);
check('highest-log rule: the best activity of the day counts (hard 60 min = 10), not the sum', near((await score()).body_score, 70 + 30 * 10 / 28), JSON.stringify(await score()));
await reset(); await checkins(A, 7);
await db.exec(`insert into public.activity_logs(user_id,activity_date,pillar,activity_type,intensity,duration_minutes) values ('${A}','${WEEK}','body','run','hard',14);
  insert into public.activity_logs(user_id,activity_date,pillar,activity_type,category,duration_minutes) values ('${A}','${WEEK}','mind','calm','mindfulness',4);`);
const md = await score();
check('minimum durations: Body under 15 min and Mind under 5 min earn nothing', n(md.body_score) === 70 && n(md.mind_score) === 70, JSON.stringify(md));
await reset(); await checkins(A, 7);
await db.exec(`insert into public.workout_sessions(user_id, performed_at) values ('${A}', '${WEEK}'::timestamptz - interval '30 minutes'), ('${A}', '${WEEK}'::timestamptz + interval '7 days')`);
check('week boundary: workouts just before the week start and at the next week start are excluded', n((await score()).body_score) === 70, JSON.stringify(await score()));
await reset(); await checkins(A, 7);
await db.exec(`insert into public.activity_logs(user_id,activity_date,pillar,activity_type,intensity,duration_minutes,client_request_id)
  values ('${A}','${WEEK}','body','run','hard',60,'00000000-0000-4000-8000-0000000000ab')`);
const retry = await attempt(db, `insert into public.activity_logs(user_id,activity_date,pillar,activity_type,intensity,duration_minutes,client_request_id)
  values ('${A}','${WEEK}','body','run','hard',60,'00000000-0000-4000-8000-0000000000ab')`);
check('offline/manual replay with the same request id is rejected and credit is unchanged', Boolean(retry) && near((await score()).body_score, 70 + 30 * 10 / 28));
const allSql = readFileSync(new URL('./live_scoring_sources.sql', import.meta.url), 'utf8') + readFileSync(new URL('./live_scoring_functions.sql', import.meta.url), 'utf8')
  + readFileSync(new URL('../../../supabase/migrations/20261126100000_m3_body_missing_data_points.sql', import.meta.url), 'utf8');
check('scoring functions never write saved weekly reports (snapshots immutable)', !/weekly_report_snapshots/.test(allSql) && !/\b(insert|update|delete)\b[^;]*\bweekly_report/i.test(allSql));
check('approved caps unchanged in the live fix: sleep 30, steps 20, active 10, workout 8, journal and Present Dad 15', ['/ 8 * 30, 30', '/ 10000 * 20, 20', '/ 30 * 10, 10', 'count(*) * 8', 'count(*) * 15'].every((t) => allSql.includes(t)));
done();
