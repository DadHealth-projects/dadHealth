// Opt-in isolated proof of migration 20261126140000 (read_weekly_report_rows) on in-process
// PostgreSQL (PGlite). Never connects to any server or production database.
//   npm i --no-save @electric-sql/pglite@0.2 && node --test tests/weeklyReportSingleRead.database.mjs
// user_has_pro_access below is the production definition, copied verbatim on 26 Nov 2026
// (md5 of prosrc 82c66069a710e77c6f9ff4fe4fdbf2b2 in production).
// Every snapshot row the function touches is counted by a forced row-level-security policy,
// so "no snapshot is read before access is known" is measured, not inferred from source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let PGlite = null;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { /* opt-in */ }
const skip = !PGlite && 'PGlite not installed (opt-in)';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const migration = readFileSync(new URL('../supabase/migrations/20261126140000_m3_weekly_report_single_read.sql', import.meta.url), 'utf8');

const LIVE_USER_HAS_PRO_ACCESS = `CREATE OR REPLACE FUNCTION public.user_has_pro_access(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select profile.manual_pro_grant
    from public.user_profile profile
    where profile.user_id = p_user_id
  ), false)
  or exists (
    select 1
    from public.subscription_entitlements entitlement
    where entitlement.user_id = p_user_id
      and entitlement.status in ('active', 'trialing', 'grace_period')
      and entitlement.current_period_end is not null
      and entitlement.current_period_end > now()
  );
$function$;`;

function payload(week, comparisonWeek) {
  return {
    version: 2, period: { weekStart: week },
    comparison: comparisonWeek === undefined ? { state: 'unavailable', reason: 'snapshot_missing' }
      : { state: 'available', previousPeriod: { weekStart: comparisonWeek } },
    details: { narrative: 'PRIVATE' },
  };
}

async function fresh() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role app_owner nologin;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role, app_owner;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    grant execute on all functions in schema auth to anon, authenticated, service_role, app_owner;
    grant usage, create on schema public to app_owner;
    grant usage on schema public to anon, authenticated, service_role;
    set role app_owner;
    create table public.user_profile(user_id uuid primary key, manual_pro_grant boolean);
    create table public.subscription_entitlements(user_id uuid, status text, current_period_end timestamptz);
    create table public.weekly_report_snapshots(user_id uuid not null, reporting_week_start date not null,
      delivery_at timestamptz not null, captured_at timestamptz not null, payload jsonb not null,
      primary key (user_id, reporting_week_start));
    create function public.count_snapshot_read() returns boolean language plpgsql volatile as $$
    begin perform set_config('test.reads', (coalesce(nullif(current_setting('test.reads', true), ''), '0')::int + 1)::text, false); return true; end $$;
    alter table public.weekly_report_snapshots enable row level security;
    alter table public.weekly_report_snapshots force row level security;
    create policy count_reads on public.weekly_report_snapshots for select using (public.count_snapshot_read());
    create policy owner_writes on public.weekly_report_snapshots for insert with check (true);
    ${LIVE_USER_HAS_PRO_ACCESS}
    ${migration}
    reset role;`);
  const rows = [
    [A, '2026-11-02', '2026-11-08T06:00Z', payload('2026-11-02')],
    [A, '2026-11-09', '2026-11-15T06:00Z', payload('2026-11-09', '2026-11-02')],
    [A, '2026-11-16', '2026-11-22T06:00Z', payload('2026-11-16', '2026-11-09')], // not delivered at "now"
    [B, '2026-11-02', '2026-11-08T06:00Z', payload('2026-11-02')],
    [B, '2026-11-09', '2026-11-15T06:00Z', payload('2026-11-09', '2026-11-02')],
  ];
  await db.exec('set role app_owner;');
  for (const [user, week, delivery, body] of rows) {
    await db.query('insert into public.weekly_report_snapshots values ($1,$2,$3,$3,$4)', [user, week, delivery, JSON.stringify(body)]);
  }
  await db.exec('reset role;');
  return db;
}
const NOW = '2026-11-16T12:00:00Z';
async function as(db, role) {
  await db.exec(`reset role; set enable_seqscan = off; select set_config('request.jwt.claim.role','${role}',false), set_config('test.reads','0',false);`);
  if (role !== 'postgres') await db.exec(`set role ${role};`);
}
async function call(db, user, week, now = NOW) {
  await db.query("select set_config('test.reads', '0', false)");
  const r = await db.query('select public.read_weekly_report_rows($1, $2, $3) as v', [user, week, now]);
  const reads = Number((await db.query("select current_setting('test.reads', true) as n")).rows[0].n);
  return { ...r.rows[0].v, reads };
}

test('read_weekly_report_rows on PostgreSQL: order, owner isolation, release, prior week and privileges', { skip }, async () => {
  const db = await fresh();

  // Callers: only service_role may run it.
  for (const role of ['anon', 'authenticated']) {
    await as(db, role);
    await assert.rejects(call(db, A, null), /permission denied/, role);
  }
  await as(db, 'postgres');
  await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
  await assert.rejects(call(db, A, null), /Service role required/);

  // Access from the live predicate: none, manual grant, active entitlement, expired entitlement.
  await as(db, 'service_role');
  let r = await call(db, A, '2026-11-09');
  assert.equal(r.access, false);
  assert.equal(r.current.reporting_week_start, '2026-11-09');
  assert.equal(r.current.user_id, A);
  assert.equal(r.prior.reporting_week_start, '2026-11-02', 'prior week from the saved comparison');
  assert.equal(r.reads, 2, 'current and prior row only');
  await db.exec(`reset role; insert into public.subscription_entitlements values ('${A}','active','2099-01-01'), ('${B}','active','2000-01-01');`);
  await as(db, 'service_role');
  assert.equal((await call(db, A, '2026-11-09')).access, true);
  assert.equal((await call(db, B, '2026-11-09')).access, false, 'expired entitlement');
  await db.exec(`reset role; insert into public.user_profile values ('${B}', true);`);
  await as(db, 'service_role');
  assert.equal((await call(db, B, '2026-11-09')).access, true, 'manual grant');

  // Latest delivered week, never a week not yet delivered.
  r = await call(db, A, null);
  assert.equal(r.current.reporting_week_start, '2026-11-09');
  r = await call(db, A, '2026-11-16');
  assert.equal(r.current, null, 'requested week not yet delivered is not returned');
  r = await call(db, A, null, '2026-11-22T06:00:00Z');
  assert.equal(r.current.reporting_week_start, '2026-11-16', 'delivered exactly at release');
  assert.equal(r.prior.reporting_week_start, '2026-11-09');

  // No comparison: no prior read. Missing prior: null. Missing week: null.
  r = await call(db, A, '2026-11-02');
  assert.equal(r.prior, null); assert.equal(r.reads, 1);
  r = await call(db, A, '2026-10-26');
  assert.equal(r.current, null); assert.equal(r.prior, null);

  // Owner isolation: B's call never returns A's rows and vice versa.
  for (const [user, other] of [[A, B], [B, A]]) {
    for (const week of [null, '2026-11-09', '2026-11-02']) {
      const out = await call(db, user, week);
      assert.doesNotMatch(JSON.stringify(out), new RegExp(other), `${user} ${week}`);
    }
  }

  // Malformed or impossible stored comparison weeks only disable the comparison.
  await db.exec(`reset role; set role app_owner;
    insert into public.weekly_report_snapshots values ('${B}','2026-11-16','2026-11-16T06:00Z','2026-11-16T06:00Z',
      '{"version":2,"period":{"weekStart":"2026-11-16"},"comparison":{"state":"available","previousPeriod":{"weekStart":"2026-13-45"}}}');`);
  await as(db, 'service_role');
  r = await call(db, B, '2026-11-16');
  assert.equal(r.current.reporting_week_start, '2026-11-16'); assert.equal(r.prior, null);

  // Works inside a read-only transaction (PostgREST runs stable functions read-only).
  await db.exec('begin transaction read only');
  assert.equal((await call(db, A, '2026-11-09')).current.user_id, A);
  await db.exec('commit');

  // Unknown access: nothing is read. Replace the predicate with one that answers NULL.
  await db.exec(`reset role; set role app_owner;
    create or replace function public.user_has_pro_access(p_user_id uuid) returns boolean language sql stable as $$ select null::boolean $$;`);
  await as(db, 'service_role');
  r = await call(db, A, '2026-11-09');
  assert.equal(r.access, null); assert.equal(r.current, null); assert.equal(r.prior, null);
  assert.equal(r.reads, 0, 'no snapshot row read before access is known');
  r = await call(db, A, null);
  assert.equal(r.reads, 0);

  // Privileges as installed.
  await as(db, 'postgres');
  const acl = (await db.query("select proacl::text a, provolatile v, prosecdef d from pg_proc where proname='read_weekly_report_rows'")).rows[0];
  assert.equal(acl.v, 's'); assert.equal(acl.d, true);
  assert.doesNotMatch(acl.a, /(^|[{,])(anon|authenticated)?=X/, 'no PUBLIC/anon/authenticated execute');
  assert.match(acl.a, /service_role=X/);

  // Rollback statement from the migration header.
  await db.exec('drop function public.read_weekly_report_rows(uuid, date, timestamptz);');
  assert.equal((await db.query("select count(*)::int n from pg_proc where proname='read_weekly_report_rows'")).rows[0].n, 0);
  await db.close();
});
