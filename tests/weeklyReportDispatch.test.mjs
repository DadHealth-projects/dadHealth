import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Date, Intl, require: name => {
    assert.ok(name in dependencies, name); return dependencies[name];
  } });
  return exports;
}
const calendar = load('src/lib/reports/weekly-report-calendar.ts');
const payloads = load('src/lib/notifications/buildPayload.ts');
function harness() {
  const h = { calls: [], sent: [], zone: 'Europe/London', enabled: true, master: true,
    state: 'available', captureError: false, sendError: false, settingsError: false };
  h.api = load('src/lib/reports/weekly-report-dispatch.ts', {
    './weekly-report-calendar': calendar,
    '@/lib/notifications/buildPayload': payloads,
    '@/lib/notifications/inbox': { ...load('src/lib/notifications/inbox.ts'), persistInbox:async(...args)=>{h.calls.push(['inbox',args[2]]);if(h.inboxError)throw Error('storage');return {id:'inbox'};} },
    '@/lib/notifications/delivery': { sendRateLimitedNotification: async args => {
      h.sent.push(args); if (h.sendError) throw Error('provider failed'); return 'sent';
    } },
  });
  h.admin = {
    rpc: async (name, args) => { h.calls.push([name, args]);
      if(name==='list_item02_due_accounts') return {data:h.alreadyCaptured?[]:[{user_id:'owner'}]};
      if(name==='notification_inbox_started_at') return {data:'2026-11-01T00:00:00Z'};
      if(name==='item03_notification_context') return {error:h.settingsError?Error('settings'):null,data:{allowed:h.master&&h.enabled&&h.api.weeklyPushTimeAllowed(new Date(h.now),h.zone),timezone:h.zone}};
      return {data:{state:h.state},error:h.captureError?Error('capture'):null};
    },
    from: () => { let after=false;const q={select:()=>q,gte:(...args)=>{h.calls.push(['source-cutoff',...args]);return q;},lte:()=>q,order:()=>q,limit:()=>q,or:()=>{after=true;return q;},
      then:resolve=>Promise.resolve({data:!after&&(h.alreadyCaptured||h.state==='available'&&!h.captureError)?[{user_id:'owner',reporting_week_start:'2026-11-09'}]:[],error:null}).then(resolve)};return q; },
  };
  h.run = (now = '2026-11-15T18:00:00Z') => {h.now=now;return h.api.dispatchWeeklyReports(h.admin, new Date(now));};
  return h;
}
test('London release chooses the saved reporting week across GMT/BST and before release', async () => {
  for (const [at, week] of [['2026-11-15T05:59:59Z','2026-11-02'], ['2026-11-15T06:00:00Z','2026-11-09'],
    ['2026-07-12T04:59:59Z','2026-06-29'], ['2026-07-12T05:00:00Z','2026-07-06']]) {
    const h = harness(); await h.run(at); assert.equal(h.calls[0][1].p_week_start, week);
  }
});
test('storage precedes preferences and disabled push never prevents capture', async () => {
  for (const flag of ['enabled','master']) {
    const h = harness(); h[flag] = false; const result = await h.run();
    assert.equal(result.reports, 1); assert.equal(h.sent.length, 0);
    assert.equal(h.calls[1][0], 'reconcile_and_capture_weekly_report');
    assert.ok(h.calls.findIndex(c=>c[0]==='inbox')<h.calls.findIndex(c=>c[0]==='item03_notification_context'));
  }
});
test('pending/scheduled reconciliation and failed generation never attempt push', async () => {
  for (const state of ['pending','scheduled','unavailable']) {
    const h = harness(); h.state = state; const result = await h.run();
    assert.equal(result.reports, 0); assert.equal(h.sent.length, 0); assert.equal(h.calls.some(c=>c[0]==='inbox'),false);
  }
  const h = harness(); h.captureError = true; assert.equal((await h.run()).errors, 1); assert.equal(h.sent.length, 0);
});
test('quiet hours are 21–08 in the account timezone; invalid zones remain pending', async () => {
  const h = harness(), allowed = h.api.weeklyPushTimeAllowed;
  for (const [at, yes] of [['2026-07-12T06:59:59Z',false],['2026-07-12T07:00:00Z',true],
    ['2026-07-12T19:59:59Z',true],['2026-07-12T20:00:00Z',false],['2026-11-15T08:00:00Z',true]]) {
    assert.equal(allowed(new Date(at), 'Europe/London'), yes);
  }
  for (const zone of [null,'','Not/AZone','Asia/Tokyo']) {
    h.zone = zone; const result = await h.run(); assert.equal(result.reports,1); assert.equal(result.sent,0);
  }
});
test('provider/settings failure leaves stored reports intact and no fake sent result', async () => {
  for (const key of ['sendError','settingsError']) {
    const h = harness(); h[key] = true; const result = await h.run();
    assert.equal(result.reports,1); assert.equal(result.sent,0); assert.equal(result.errors,1);
  }
});
test('cross-day retries use the same week identity and generic saved-week payload', async () => {
  const h = harness(); await h.run(); await h.run('2026-11-16T12:00:00Z');
  assert.equal(h.sent[0].eventKey, h.sent[1].eventKey);
  assert.equal(h.sent[0].eventKey, 'weekly-report:2026-11-09');
  assert.equal(h.sent[0].payload.data.reporting_week, '2026-11-09');
  assert.doesNotMatch(JSON.stringify(h.sent[0].payload), /score":|streak|protected|focus/);
});
test('latest read is owner scoped and release filtered; exact-week never falls back', async () => {
  const calls = [];
  const q = {};
  for (const method of ['select','eq','lte','order','limit']) q[method] = (...args) => { calls.push([method,...args]); return q; };
  q.maybeSingle = async () => ({ data: null });
  const admin = { rpc: async () => ({ data: false }), from: () => q };
  const { readWeeklyReport } = load('src/lib/reports/weekly-report-snapshots.ts', {
    './weekly-report-calendar': calendar, './weekly-report': load('src/lib/reports/weekly-report.ts'),
  });
  const now = new Date('2026-11-16T12:00:00Z');
  assert.equal((await readWeeklyReport(admin, 'owner', undefined, now)).reason, 'snapshot_missing');
  assert.ok(calls.some(c => c[0]==='eq' && c[1]==='user_id' && c[2]==='owner'));
  assert.ok(calls.some(c => c[0]==='lte' && c[1]==='delivery_at' && c[2]===now.toISOString()));
  assert.ok(calls.some(c => c[0]==='limit' && c[1]===1));
  calls.length = 0;
  await readWeeklyReport(admin, 'owner', '2026-11-02', now);
  assert.ok(calls.some(c => c[0]==='eq' && c[1]==='reporting_week_start' && c[2]==='2026-11-02'));
  assert.equal(calls.some(c => c[0]==='order'), false);
});

// Explicit opt-in: only the network-isolated local database, never production.
const sqlEnabled = process.env.PHASE_D_SQL_TESTS === '1';
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

const sqlSource = readFileSync(new URL('../supabase/tests/item02_delivery_integration.test.sql', import.meta.url), 'utf8');
test('SQL: release, scheduled activation, cross-day identity, quiet hours and ownership', {skip:!sqlEnabled}, () => {
  const result=database(sqlSource);
  assert.equal(result.split('\n').filter(line=>line.startsWith('PASS:')).length,19);
});
test('SQL: concurrent weekly jobs wait on the same lock and reuse one claim; rollback leaves no claim', {skip:!sqlEnabled,timeout:30000}, async () => {
  const uid='7d000000-0000-4000-8000-000000000001';
  // Commit only the SQL file's isolated fixture, then use independent sessions.
  database(sqlSource.slice(0,sqlSource.indexOf('create temp table first_claim'))+'\ncommit;');
  const holder=connection('d_holder'), one=connection('d_one'), two=connection('d_two');
  const claim=`set request.jwt.claim.role='service_role'; select public.claim_notification_delivery('${uid}','weekly_score',
    (select timezone from user_profile where user_id='${uid}'),
    'weekly-report:'||(select reporting_week_start from weekly_report_snapshots where user_id='${uid}'));`;
  try {
    await holder.send(`begin; select pg_advisory_xact_lock(hashtextextended('${uid}',0));`);
    const a=one.send("set application_name='phase_d_one';"+claim);
    const b=two.send("set application_name='phase_d_two';"+claim);
    await waitFor("select count(*)=2 from pg_stat_activity where application_name in ('phase_d_one','phase_d_two') and wait_event='advisory';");
    await holder.send('commit;');
    const [first,second]=await Promise.all([a,b]); assert.equal(first,second);assert.match(first,/^[0-9a-f-]{36}$/);
    assert.equal(database(`select count(*) from notification_delivery_claims where user_id='${uid}';`),'1');
    database(`delete from notification_delivery_claims where user_id='${uid}';`);
    await one.send('begin;'+claim+'rollback;');
    assert.equal(database(`select count(*) from notification_delivery_claims where user_id='${uid}';`),'0');
    assert.match(await two.send(claim),/^[0-9a-f-]{36}$/);
  } finally {holder.close();one.close();two.close();database(`delete from auth.users where id='${uid}';`);}
});

test('saved report survives event persistence failure and retries after capture selection stops',async()=>{
 const h=harness();h.alreadyCaptured=true;h.inboxError=true;const failed=await h.run();assert.equal(failed.errors,1);assert.equal(h.sent.length,0);
 h.inboxError=false;await h.run();assert.equal(h.sent.length,1);assert.equal(h.sent[0].eventKey,'weekly-report:2026-11-09');
 assert.ok(h.calls.some(c=>c[0]==='source-cutoff'&&c[1]==='captured_at'));
 assert.equal(h.calls.some(c=>c[0]==='reconcile_and_capture_weekly_report'),false);
});
