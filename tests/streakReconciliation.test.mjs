import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';

function moduleAt(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL, Date, require: id => {
    if (!(id in dependencies)) throw Error(`Unexpected dependency ${id}`);
    return dependencies[id];
  } });
  return exports;
}
const { readStreakStatus } = moduleAt('src/lib/streaks/status.ts');
function valid(overrides = {}) {
  return { state: 'current', count: 6, lastKnownCount: 6, reconciledThrough: '2026-11-12',
    protectedDates: ['2026-11-10'], allowance: 0, activationAt: '2026-11-09T00:00:00Z', pendingDate: null, ...overrides };
}
function apiHarness() {
  const h = { signedIn: true, calls: [], data: valid(), error: null, throws: false };
  const admin = { rpc: async (...args) => {
    h.calls.push(args); if (h.throws) throw Error('PRIVATE'); return { data: h.data, error: h.error };
  } };
  const { GET } = moduleAt('src/app/api/streaks/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/native-subscriptions/auth': { authenticateNativeSubscriptionRequest: async () =>
      h.signedIn ? { user: { id: 'owner' }, admin } : null },
    '@/lib/streaks/status': { readStreakStatus },
  });
  h.get = (query = '') => GET(new Request(`https://example.test/api/streaks${query}`));
  return h;
}

test('streak GET authenticates ownership and only reads the status RPC', async () => {
  const h = apiHarness(); h.signedIn = false;
  assert.equal((await h.get()).status, 401); assert.equal(h.calls.length, 0);
  h.signedIn = true; const response = await h.get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Vary'), 'Authorization');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [['read_checkin_streak_status', { p_user_id: 'owner' }]]);
  // The database omits resetOn here (pre-20261125120000 shape); the API states it as null.
  assert.deepEqual((await response.json()).streak, { ...valid(), resetOn: null });
});
test('GET rejects user, observation time and arbitrary query overrides', async () => {
  for (const query of ['?user_id=other', '?observedAt=2026-11-09', '?week=2026-11-09']) {
    const h = apiHarness(); assert.equal((await h.get(query)).status, 400); assert.equal(h.calls.length, 0);
  }
});
test('pending and scheduled status never expose a current count or usable allowance', async () => {
  for (const state of ['pending', 'scheduled']) {
    const h = apiHarness(); h.data = valid({ state, count: null, allowance: null });
    const response = await h.get(); assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(data.streak.count, null); assert.equal(data.streak.lastKnownCount, 6);
    assert.equal(data.streak.allowance, null);
  }
});
test('Free current zero and unused Pro allowance remain distinct from unknown', async () => {
  for (const allowance of [0, 1]) {
    const h = apiHarness(); h.data = valid({ count: 0, allowance, protectedDates: [] });
    const result = await (await h.get()).json();
    assert.equal(result.streak.count, 0); assert.equal(result.streak.allowance, allowance);
  }
});
test('status projection rejects malformed data and never leaks internal fields', async () => {
  for (const overrides of [{ count: -1 }, { state: 'pending' }, { reconciledThrough: '2026-02-30' },
    { protectedDates: ['private'] }, { activationAt: 'not-a-date' }, { allowance: 2 }, { state: 'invented' }]) {
    const h = apiHarness(); h.data = valid(overrides);
    assert.equal((await h.get()).status, 503);
  }
  const h = apiHarness(); h.data = { ...valid(), privateEvidence: 'SECRET', user_id: 'OTHER' };
  assert.doesNotMatch(JSON.stringify(await (await h.get()).json()), /SECRET|OTHER|privateEvidence/);
});
test('failed reads and thrown errors remain unavailable, never Free or empty', async () => {
  for (const failure of ['error', 'throws']) {
    const h = apiHarness(); h[failure] = failure === 'error' ? { message: 'PRIVATE' } : true;
    const response = await h.get(); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { state: 'unavailable', reason: 'read_failed', streak: null });
  }
});
test('parallel account reads pass separate owner IDs without a shared cache', async () => {
  const owners = [];
  const admin = { rpc: async (_name, args) => { owners.push(args.p_user_id); return { data: valid(), error: null }; } };
  await Promise.all([readStreakStatus(admin, 'one'), readStreakStatus(admin, 'two')]);
  assert.deepEqual(owners, ['one', 'two']);
});

// Opt-in real SQL tests. Hardcoded local container/database, network disabled;
// never accept a DATABASE_URL or fall back to the linked Supabase project.
const sqlEnabled = process.env.PHASE_C_SQL_TESTS === '1';
const container = 'dadhealth-weekly-full-schema';
const db = 'dadhealth_phase_c';
const command = ['exec', '-i', container, 'psql', '-U', 'supabase_admin', '-d', db, '-Atq', '-v', 'ON_ERROR_STOP=1'];
function database(sql) {
  const inspect = spawnSync('docker', ['inspect', container, '--format', '{{.HostConfig.NetworkMode}}'], { encoding: 'utf8' });
  assert.equal(inspect.status, 0, inspect.stderr); assert.equal(inspect.stdout.trim(), 'none');
  const result = spawnSync('docker', command, { input: sql, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
function connection(name) {
  const child = spawn('docker', command);
  let output = '', error = '', pending;
  child.stdout.on('data', bytes => { output += bytes; if (pending && output.includes(pending.marker)) {
    const result = output.slice(0, output.indexOf(pending.marker)).trim(); output = output.slice(output.indexOf(pending.marker) + pending.marker.length);
    pending.resolve(result); pending = undefined;
  } });
  child.stderr.on('data', bytes => { error += bytes; });
  child.on('error', e => pending?.reject(e));
  child.on('close', code => pending?.reject(Error(`SQL session closed ${code}: ${error}`)));
  return {
    async send(sql) {
      assert.equal(pending, undefined);
      const marker = `done_${name}_${Math.random().toString(36).slice(2)}`;
      const promise = new Promise((resolve, reject) => { pending = { marker, resolve, reject }; });
      child.stdin.write(`${sql}\nselect '${marker}';\n`); return promise;
    },
    close() { child.stdin.end('rollback;\n\\q\n'); },
  };
}
async function waitFor(sql) {
  for (let i = 0; i < 60; i++) {
    if (database(sql) === 't') return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('Expected real database lock contention was not observed');
}
const uid = '7c000000-0000-4000-8000-000000009001';
function setup() {
  database(`delete from auth.users where id='${uid}'; insert into auth.users(id) values('${uid}');
    insert into user_profile(user_id,timezone,manual_pro_grant) values('${uid}','UTC',true)
      on conflict(user_id) do update set timezone='UTC',manual_pro_grant=true;
    insert into user_streaks(user_id,streak_count,last_activity_date) values('${uid}',4,current_date-2)
      on conflict(user_id) do update set streak_count=4,last_activity_date=current_date-2;
    update streak_reconciliation_state set activation_at=(current_date-1)::timestamp at time zone 'UTC',
      start_date=current_date-1,evidence_from=(current_date-2)::timestamp at time zone 'UTC',
      baseline_count=4,baseline_last_date=current_date-2 where user_id='${uid}';
    delete from streak_access_evidence where user_id='${uid}';
    insert into streak_access_evidence(user_id,source_key,recorded_at,grants_access)
      values('${uid}','manual',(current_date-2)::timestamp at time zone 'UTC',true);`);
}
function cleanup() { database(`delete from auth.users where id='${uid}';`); }

test('SQL: chronological reconciliation, repair, calendar and permission assertions', { skip: !sqlEnabled }, () => {
  const output = database(readFileSync(new URL('../supabase/tests/checkin_streak_reconciliation.test.sql', import.meta.url), 'utf8'));
  const passed = output.split('\n').filter(line => line.startsWith('PASS:')).length;
  assert.equal(passed, 56, `Unexpected SQL assertion count: ${passed}`);
  console.log(`Phase C SQL behavioural assertions: ${passed} passed`);
});
test('SQL: real competing check-ins wait on the user lock and settle without double count', { skip: !sqlEnabled, timeout: 30000 }, async () => {
  setup(); const holder = connection('holder'), one = connection('one'), two = connection('two');
  try {
    await holder.send(`begin; select pg_advisory_xact_lock(hashtextextended('streak:${uid}',0));`);
    const a = one.send(`set application_name='phase_c_one'; insert into mood_logs(user_id,date,mood_value) values('${uid}',current_date,3);`);
    const b = two.send(`set application_name='phase_c_two'; insert into mood_logs(user_id,date,mood_value) values('${uid}',current_date-1,3);`);
    await waitFor("select count(*)=2 from pg_stat_activity where application_name in ('phase_c_one','phase_c_two') and wait_event='advisory';");
    console.log('Observed two independent sessions waiting on the streak advisory lock');
    await holder.send('commit;'); await Promise.all([a, b]);
    assert.equal(database(`select streak_count from user_streaks where user_id='${uid}';`), '6');
    assert.equal(database(`select count(*) from streak_checkin_receipts where user_id='${uid}';`), '2');
    assert.equal(database(`select count(*) from user_streak_freezes where user_id='${uid}';`), '0');
  } finally { holder.close(); one.close(); two.close(); cleanup(); }
});
test('SQL: receipt precedes lock wait and concurrent reconciliation sees committed check-in', { skip: !sqlEnabled, timeout: 30000 }, async () => {
  setup(); const holder = connection('receipt_holder'), writer = connection('receipt_writer'), worker = connection('receipt_worker');
  try {
    await holder.send(`begin; select pg_advisory_xact_lock(hashtextextended('streak:${uid}',0));`);
    const pending = writer.send(`set application_name='phase_c_receipt'; insert into mood_logs(user_id,date,mood_value) values('${uid}',current_date,3);`);
    await waitFor("select exists(select 1 from pg_stat_activity where application_name='phase_c_receipt' and wait_event='advisory');");
    const reconciliation = worker.send(`set application_name='phase_c_worker';
      set request.jwt.claim.role='service_role'; select reconcile_checkin_streak('${uid}');`);
    await waitFor("select count(*)=2 from pg_stat_activity where application_name in ('phase_c_receipt','phase_c_worker') and wait_event='advisory';");
    const releasedAt = database('select clock_timestamp();');
    await holder.send('commit;'); await Promise.all([pending, reconciliation]);
    assert.equal(database(`select received_at<'${releasedAt}'::timestamptz from streak_checkin_receipts where user_id='${uid}';`), 't');
    const before = database(`select apply_checkin_streak('${uid}',clock_timestamp())->>'count';`);
    assert.equal(before, '5');
    assert.equal(database(`select apply_checkin_streak('${uid}',clock_timestamp())->>'count';`), before);
  } finally { holder.close(); writer.close(); worker.close(); cleanup(); }
});
test('SQL: rolled-back check-in and evidence leave no partial state; retry succeeds', { skip: !sqlEnabled, timeout: 30000 }, async () => {
  setup(); const tx = connection('rollback');
  try {
    const baseline = database(`select row_to_json(s) from user_streaks s where user_id='${uid}';`);
    const facts = database(`select count(*) from streak_access_evidence where user_id='${uid}';`);
    await tx.send(`begin; insert into mood_logs(user_id,date,mood_value) values('${uid}',current_date,3);
      update user_profile set manual_pro_grant=false where user_id='${uid}'; rollback;`);
    assert.equal(database(`select count(*) from streak_checkin_receipts where user_id='${uid}';`), '0');
    assert.equal(database(`select count(*) from streak_access_evidence where user_id='${uid}';`), facts);
    assert.equal(database(`select row_to_json(s) from user_streaks s where user_id='${uid}';`), baseline);
    database(`insert into mood_logs(user_id,date,mood_value) values('${uid}',current_date,3);`);
    assert.equal(database(`select streak_count from user_streaks where user_id='${uid}';`), '5');
  } finally { tx.close(); cleanup(); }
});
test('SQL: evidence writes do not wait on streak lock or change access semantics', { skip: !sqlEnabled, timeout: 30000 }, async () => {
  setup(); const holder = connection('evidence_holder');
  try {
    await holder.send(`begin; select pg_advisory_xact_lock(hashtextextended('streak:${uid}',0));`);
    database(`set statement_timeout='3s'; update user_profile set manual_pro_grant=false where user_id='${uid}';`);
    assert.equal(database(`select user_has_pro_access('${uid}');`), 'f');
    assert.equal(database(`select count(*) from streak_access_evidence where user_id='${uid}';`), '2');
    await holder.send('commit;');
  } finally { holder.close(); cleanup(); }
});
test('SQL: check-in received before activation but blocked until after is counted once', { skip: !sqlEnabled, timeout: 30000 }, async () => {
  setup(); const holder = connection('activation_holder'), writer = connection('activation_writer');
  try {
    database(`update streak_reconciliation_state set activation_at=clock_timestamp()+interval '1 day',
      start_date=current_date,baseline_count=4,baseline_last_date=current_date-2 where user_id='${uid}';`);
    await holder.send(`begin; select pg_advisory_xact_lock(hashtextextended('streak:${uid}',0));`);
    const pending = writer.send(`set application_name='phase_c_activation'; insert into mood_logs(user_id,date,mood_value) values('${uid}',current_date-1,3);`);
    await waitFor("select exists(select 1 from pg_stat_activity where application_name='phase_c_activation' and wait_event='advisory');");
    // Owner fixture advances the activation boundary past receipt time while the
    // real writer waits. No public clock override exists.
    await holder.send(`update streak_reconciliation_state set activation_at=clock_timestamp() where user_id='${uid}'; commit;`);
    await pending;
    assert.equal(database(`select baseline_count from streak_reconciliation_state where user_id='${uid}';`), '5');
    assert.equal(database(`select streak_count from user_streaks where user_id='${uid}';`), '5');
    database(`insert into mood_logs(user_id,date,mood_value) values('${uid}',current_date-1,4)
      on conflict(user_id,date) do update set mood_value=excluded.mood_value;`);
    assert.equal(database(`select apply_checkin_streak('${uid}',clock_timestamp())->>'count';`), '5');
  } finally { holder.close(); writer.close(); cleanup(); }
});
