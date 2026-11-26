// Opt-in isolated proof of migration 20261126150000 (timezone lookup cache) on in-process
// PostgreSQL (PGlite). Never connects to any server or production database.
//   npm i --no-save @electric-sql/pglite@0.2 && node --test tests/timezoneLookupCache.database.mjs
// The "before" functions are the repo definitions, which match production byte for byte
// (md5 of prosrc compared on 26 Nov 2026). The same inputs are run before and after the
// migration and every answer must be identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let PGlite = null;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { /* opt-in */ }
const skip = !PGlite && 'PGlite not installed (opt-in)';
const file = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CAL = file('20261111120000_mind_participation_and_scoring_calendar.sql');
const NOTIF = file('20261125100000_m3_notification_rules.sql');
const MIGRATION = file('20261126150000_m3_timezone_lookup_cache.sql');

/** The last full `create or replace function public.<fn>(...)` statement in a migration. */
function statement(sql, fn) {
  const starts = [...sql.matchAll(new RegExp(`create or replace function public\\.${fn}\\(`, 'gi'))].map(m => m.index);
  const start = starts.at(-1);
  const as = /\bas\s+(\$[a-z_]*\$)/i.exec(sql.slice(start));
  const bodyStart = start + as.index + as[0].length;
  const end = sql.indexOf(as[1], bodyStart) + as[1].length;
  return sql.slice(start, end) + ';';
}
const BEFORE = [statement(CAL, 'scoring_timezone_at'), statement(CAL, 'scoring_date_at'),
  statement(CAL, 'capture_scoring_timezone'), statement(NOTIF, 'item03_inbox_context')].join('\n');

const U = n => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

async function fresh() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users(id uuid primary key);
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.user_profile(user_id uuid primary key, timezone text);
    create table public.scoring_timezone_history(user_id uuid not null, effective_week_start date not null,
      effective_at timestamptz not null, timezone text not null, primary key (user_id, effective_week_start));
    create table public.notification_preferences(user_id uuid, notification_type text, send_time time);
    create table public.mood_logs(user_id uuid, date date);
    create table public.dad_score_view(user_id uuid, mind_score numeric, body_score numeric, bond_score numeric,
      weakest_pillar text, mind_week_change numeric, body_week_change numeric, bond_week_change numeric);
    create table public.workouts(id uuid, source text, access_level text, duration_mins int);
    create table public.subscription_entitlements(id uuid, user_id uuid, status text, provider text,
      latest_transaction_id text, environment text, trial_end timestamptz, current_period_end timestamptz);
    create table public.notification_trial_episodes(id uuid, user_id uuid, subscription_id uuid, provider text,
      transaction_id text, environment text, ends_at timestamptz, started_at timestamptz);
    ${BEFORE}
    create trigger capture_scoring_timezone after insert or update of timezone on public.user_profile
      for each row execute function public.capture_scoring_timezone();
    insert into auth.users select ('00000000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid from generate_series(1, 20) g;`);
  return db;
}

/** Fixture members: every path through the timezone fallback. Invalid rows bypass the trigger. */
async function seed(db) {
  await db.exec(`
    insert into public.user_profile values ('${U(1)}', 'Europe/London'), ('${U(2)}', 'America/New_York'), ('${U(3)}', 'Asia/Kolkata');
    alter table public.user_profile disable trigger capture_scoring_timezone;
    insert into public.user_profile values ('${U(4)}', 'Asia/Karachi'), ('${U(5)}', 'Not/AZone'), ('${U(6)}', null),
      ('${U(7)}', ''), ('${U(8)}', 'UTC'), ('${U(9)}', 'EST'), ('${U(10)}', 'Pacific/Chatham');
    alter table public.user_profile enable trigger capture_scoring_timezone;
    update public.user_profile set timezone = 'Australia/Sydney' where user_id = '${U(2)}';
    insert into public.scoring_timezone_history values ('${U(12)}', '-infinity', '-infinity', 'Europe/Paris');
    insert into public.notification_preferences values ('${U(1)}', 'morning_checkin', '08:00'), ('${U(4)}', 'morning_checkin', '20:45');`);
}
const USERS = Array.from({ length: 13 }, (_, i) => U(i + 1)); // 11 and 13: no profile, no history
const TIMES = ['2026-03-29T00:30:00Z', '2026-03-29T01:30:00Z', '2026-10-25T00:30:00Z', '2026-11-26T12:00:00Z', '2026-12-31T23:59:00Z', '2099-01-01T00:00:00Z'];

async function answers(db) {
  const out = {};
  for (const u of USERS) for (const t of TIMES) {
    const r = await db.query('select public.scoring_timezone_at($1,$2) tz, public.scoring_date_at($1,$2)::text d', [u, t]);
    out[`${u}@${t}`] = r.rows[0];
  }
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  for (const u of USERS) {
    const v = (await db.query('select public.item03_inbox_context($1) v', [u])).rows[0].v;
    delete v.observedAt; // clock_timestamp(); everything else must match
    out[`inbox:${u}`] = v;
  }
  out.history = (await db.query("select user_id::text, effective_week_start::text, effective_at::text, timezone from public.scoring_timezone_history order by 1, 2")).rows;
  return out;
}

/** The trigger's accept/reject decisions and resulting history, run as the same sequence. */
async function triggerOutcomes(db) {
  const steps = [
    `insert into public.user_profile values ('${U(15)}', 'Europe/Berlin')`,
    `insert into public.user_profile values ('${U(16)}', 'Mars/Olympus')`,
    `insert into public.user_profile values ('${U(17)}', '')`,
    `insert into public.user_profile values ('${U(18)}', null)`,
    `update public.user_profile set timezone = 'Asia/Tokyo' where user_id = '${U(15)}'`,
    `update public.user_profile set timezone = 'bogus' where user_id = '${U(15)}'`,
    `update public.user_profile set timezone = 'Asia/Tokyo' where user_id = '${U(15)}'`,
    `update public.user_profile set timezone = 'America/Los_Angeles' where user_id = '${U(5)}'`, // from an invalid stored zone
  ];
  const results = [];
  for (const sql of steps) {
    try { await db.exec(sql); results.push('ok'); } catch (e) { results.push(e.message); }
  }
  results.push((await db.query("select user_id::text, effective_week_start::text, timezone from public.scoring_timezone_history where user_id::text like '%00000015' or user_id::text like '%00000016' or user_id::text like '%00000017' or user_id::text like '%00000018' or user_id::text like '%00000005' order by 1, 2")).rows);
  return results;
}

test('timezone lookup cache: identical answers before and after, every name, privileges, speed', { skip }, async () => {
  const before = await fresh(); await seed(before);
  const after = await fresh(); await seed(after);
  await after.exec(MIGRATION);

  assert.deepEqual(await answers(after), await answers(before), 'scoring_timezone_at, scoring_date_at, item03_inbox_context and stored history');
  assert.deepEqual(await triggerOutcomes(after), await triggerOutcomes(before), 'capture_scoring_timezone accepts and rejects the same values');

  // Every server timezone name, plus invalid and edge inputs: the helper equals pg_timezone_names.
  const mismatch = (await after.query(`
    with inputs(n) as (select name from pg_timezone_names union all values (null), (''), ('Not/AZone'), ('europe/london'), (' UTC'), ('BST'), ('+05'), ('posixrules'))
    select count(*) filter (where public.is_known_timezone(n) is distinct from exists (select 1 from pg_timezone_names z where z.name = n))::int bad,
           count(*)::int total from inputs`)).rows[0];
  assert.equal(mismatch.bad, 0); assert.ok(mismatch.total > 400, `checked ${mismatch.total} inputs`);
  assert.equal((await after.query('select count(*)::int n from public.scoring_timezone_names')).rows[0].n,
    (await after.query('select count(*)::int n from pg_timezone_names')).rows[0].n);

  // A zone added to the server after the copy is still accepted (falls back to the live list).
  await after.exec("delete from public.scoring_timezone_names where name = 'Europe/Kyiv'");
  assert.equal((await after.query("select public.is_known_timezone('Europe/Kyiv') v")).rows[0].v, true);

  // No pg_timezone_names left in the three rewritten functions; owners, security definer, search_path kept.
  const defs = (await after.query(`select proname, prosrc, prosecdef, array_to_string(proconfig, ',') cfg, provolatile from pg_proc
    where proname in ('scoring_timezone_at','capture_scoring_timezone','item03_inbox_context','is_known_timezone') order by 1`)).rows;
  for (const d of defs) {
    assert.equal(d.prosecdef, true, d.proname);
    assert.equal(d.cfg, 'search_path=pg_catalog, public', d.proname);
    if (d.proname !== 'is_known_timezone') assert.doesNotMatch(d.prosrc, /pg_timezone_names/, d.proname);
  }
  assert.equal(defs.find(d => d.proname === 'scoring_timezone_at').provolatile, 's');

  // Client roles can neither read the cache nor call the helper.
  for (const role of ['anon', 'authenticated']) {
    await after.exec(`set role ${role}`);
    await assert.rejects(after.query('select count(*) from public.scoring_timezone_names'), /permission denied/, role);
    await assert.rejects(after.query("select public.is_known_timezone('UTC')"), /permission denied/, role);
    await after.exec('reset role');
  }

  // Speed: the fallback profile (no history) before vs after, same machine.
  const time = async (db) => { const t = performance.now();
    for (let i = 0; i < 20; i++) await db.query('select public.scoring_timezone_at($1, now())', [U(4)]);
    return (performance.now() - t) / 20; };
  const slow = await time(before), fast = await time(after);
  console.log(`scoring_timezone_at, profile without history: before ${slow.toFixed(2)} ms, after ${fast.toFixed(2)} ms per call (PGlite)`);
  assert.ok(fast < slow, 'faster after the migration');
  await before.close(); await after.close();
});
