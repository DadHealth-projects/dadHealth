// Opt-in isolated proof of migration 20261126121000 (health sync boundaries) on in-process
// PostgreSQL (PGlite), on top of migration 06 (20261125140000, identical to production, comment-
// insensitive fingerprint checked 27 Nov 2026) and the live RLS shape of body_metrics, sleep_logs
// and user_integrations. Never connects to any server.
//   npm i --no-save @electric-sql/pglite@0.2 && node --test tests/healthSyncBoundaries.database.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let PGlite = null;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { /* opt-in */ }
const skip = !PGlite && 'PGlite not installed (opt-in)';
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const M06 = read('20261125140000_m3_health_sleep_corrections.sql');
const M121 = read('20261126121000_health_sync_boundaries.sql');
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b';
const LA = '10000000-0000-4000-8000-00000000000a', LB = '10000000-0000-4000-8000-00000000000b';

async function fresh(apply121 = true) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    grant usage on schema auth to anon, authenticated, service_role; grant execute on all functions in schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.account_deletion_tombstones(user_id uuid primary key);
    create function public.privacy_current_account_available() returns boolean language sql stable security definer set search_path=pg_catalog,public
      as $$ select auth.uid() is not null and not exists (select 1 from public.account_deletion_tombstones where user_id = auth.uid()) $$;
    grant execute on function public.privacy_current_account_available() to authenticated, service_role;
    create table public.user_integrations(id uuid primary key, user_id uuid not null, provider text not null, last_sync_at timestamptz, unique(user_id, provider));
    create table public.body_metrics(user_id uuid not null, metric_type text not null, value numeric, recorded_at timestamptz not null, source text,
      unique(user_id, metric_type, recorded_at));
    create table public.sleep_logs(user_id uuid not null, date date not null, hours numeric, source text, unique(user_id, date));
    -- Live RLS: own-row CRUD plus the restrictive deleted-session guard; table grants to authenticated.
    do $$ declare t text; begin foreach t in array array['user_integrations','body_metrics','sleep_logs'] loop
      execute format('alter table public.%I enable row level security', t);
      execute format('create policy own on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
      execute format('create policy privacy_deleted_session on public.%I as restrictive for all to authenticated using (public.privacy_current_account_available()) with check (public.privacy_current_account_available())', t);
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end loop; end $$;
    insert into auth.users values ('${A}'), ('${B}');
    insert into public.user_integrations values ('${LA}', '${A}', 'apple_health', null), ('${LB}', '${B}', 'health_connect', null);
    ${M06}
    grant execute on function public.upsert_apple_health_daily_data(jsonb, jsonb), public.upsert_health_connect_daily_data(jsonb, jsonb) to anon, authenticated, service_role;
    ${apply121 ? M121 : ''}`);
  return db;
}
async function as(db, sub) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ''}', false), set_config('request.jwt.claim.role', '${sub ? 'authenticated' : 'anon'}', false);`);
  await db.exec(`set role ${sub ? 'authenticated' : 'anon'}`);
}
const metrics = (day, steps) => JSON.stringify([{ metric_type: 'steps', value: steps, recorded_at: `${day}T12:00:00Z` }]);
const sleep = (day, hours) => JSON.stringify([{ date: day, hours }]);
async function table(db) {
  await db.exec('reset role');
  const m = (await db.query('select user_id::text u, metric_type, value::text v, source from public.body_metrics order by 1,2,recorded_at')).rows;
  const s = (await db.query('select user_id::text u, date::text d, hours::text h, source from public.sleep_logs order by 1,2')).rows;
  const i = (await db.query('select user_id::text u, last_sync_at is not null synced from public.user_integrations order by 1')).rows;
  return { m, s, i };
}

test('health sync boundaries: owner-bound, manual-safe, same-provider clearing, completeness, old builds, deletion', { skip }, async () => {
  const db = await fresh();
  // Manual records the import must never overwrite.
  await db.exec(`insert into public.body_metrics values ('${A}', 'steps', 999, '2026-11-20T08:00:00Z', 'manual');
    insert into public.sleep_logs values ('${A}', '2026-11-21', 6, 'manual'), ('${A}', '2026-11-22', 7.5, 'apple_health')`);
  await as(db, A);
  const r = (await db.query(`select public.sync_native_health_daily_data('apple_health', '${LA}', $1, $2, false) v`,
    [JSON.stringify([...JSON.parse(metrics('2026-11-20', 5000)), ...JSON.parse(metrics('2026-11-23', 8000))]),
     JSON.stringify([{ date: '2026-11-21', hours: 8 }, { date: '2026-11-22', hours: 0 }, { date: '2026-11-23', hours: 7 }])])).rows[0].v;
  assert.equal(r.metrics_written, 1, 'manual day protected'); assert.equal(r.sleep_written, 1); assert.equal(r.sleep_cleared, 1);
  assert.equal(r.synced_at, null, 'partial read: no completeness stamp');
  let t = await table(db);
  assert.deepEqual(t.s.map(x => [x.d, x.h, x.source]), [['2026-11-21', '6', 'manual'], ['2026-11-23', '7', 'apple_health']]);
  assert.equal(t.m.find(x => x.v === '999').source, 'manual');
  assert.equal(t.i.find(x => x.u === A).synced, false);
  await as(db, A);
  const full = (await db.query(`select public.sync_native_health_daily_data('apple_health', '${LA}', '[]', '[]', true) v`)).rows[0].v;
  assert.ok(full.synced_at, 'complete read stamps the connection');

  // Another member's connection, the wrong provider, or no session: rejected.
  await assert.rejects(db.query(`select public.sync_native_health_daily_data('health_connect', '${LB}', '[]', '[]', true)`), /integration_not_connected/);
  await assert.rejects(db.query(`select public.sync_native_health_daily_data('health_connect', '${LA}', '[]', '[]', true)`), /integration_not_connected/);
  // Under the member's own RLS, another member's connection is invisible: rejected without revealing it.
  await assert.rejects(db.query(`select public.write_health_daily_totals('${LB}', '[]', '[]', true)`), /integration_not_connected|Not authorised/);
  await as(db, null);
  await assert.rejects(db.query(`select public.sync_native_health_daily_data('apple_health', '${LA}', '[]', '[]', true)`), /permission denied/);
  await assert.rejects(db.query(`select public.write_health_daily_totals('${LA}', '[]', '[]', true)`), /permission denied/);
  await assert.rejects(db.query(`select public.upsert_apple_health_daily_data('[]', '[]')`), /permission denied/, 'anonymous execute removed');

  // Validation: Apple/Health Connect cannot send resting heart rate; impossible values rejected.
  await as(db, A);
  for (const [m, s] of [[`[{"metric_type":"resting_hr","value":60,"recorded_at":"2026-11-23T00:00:00Z"}]`, '[]'],
    [`[{"metric_type":"steps","value":-1,"recorded_at":"2026-11-23T00:00:00Z"}]`, '[]'], ['[]', `[{"date":"2026-11-23","hours":25}]`],
    ['[]', `[{"date":"2026-11-23","hours":"NaN"}]`], ['{}', '[]']]) {
    await assert.rejects(db.query(`select public.sync_native_health_daily_data('apple_health', '${LA}', $1, $2, false)`, [m, s]), /Invalid health totals/);
  }

  // Old builds: the legacy function still works for the owner (now with the same guards), and
  // still rejects without a live connection.
  const legacy = (await db.query(`select public.upsert_apple_health_daily_data($1, $2) v`, [metrics('2026-11-24', 4000), sleep('2026-11-24', 6.5)])).rows[0].v;
  assert.equal(legacy.metrics_written, 1); assert.equal(legacy.sleep_written, 1);
  await as(db, B);
  await assert.rejects(db.query(`select public.upsert_apple_health_daily_data('[]', '[]')`), /integration_not_connected/, 'B has no Apple connection');

  // Deleted account (tombstoned): uploads rejected even with a live connection row.
  await db.exec(`reset role; insert into public.account_deletion_tombstones values ('${A}')`);
  await as(db, A);
  await assert.rejects(db.query(`select public.sync_native_health_daily_data('apple_health', '${LA}', '[]', '[]', true)`), /integration_not_connected|Account unavailable/);
  await db.close();
});

test('same upload gives the same stored rows as migration 06 for an old build', { skip }, async () => {
  const run = async apply => {
    const db = await fresh(apply);
    await db.exec(`insert into public.sleep_logs values ('${A}', '2026-11-21', 6, 'manual'), ('${A}', '2026-11-22', 7.5, 'apple_health'), ('${A}', '2026-11-25', 7, 'health_connect')`);
    await as(db, A);
    await db.query('select public.upsert_apple_health_daily_data($1, $2)', [metrics('2026-11-23', 8000),
      JSON.stringify([{ date: '2026-11-21', hours: 8 }, { date: '2026-11-22', hours: 0 }, { date: '2026-11-25', hours: 0 }, { date: '2026-11-23', hours: 7 }])]);
    const t = await table(db); await db.close(); return { m: t.m, s: t.s };
  };
  assert.deepEqual(await run(true), await run(false));
});
