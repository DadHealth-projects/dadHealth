import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function load(path, mocks = {}, logs = []) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, process: { env: {} }, console: { info() {}, warn: (...args) => logs.push(JSON.parse(JSON.stringify(args))) },
    require: (name) => {
      if (name === './inbox' && !(name in mocks)) return load('src/lib/notifications/inbox.ts');
      assert.ok(name in mocks, name); return mocks[name];
    },
  });
  return exports;
}
// Verified trial end 48 h ahead (inside the 2-day window), owner-scoped like the real query.
const trialEnds = (ids) => { let owner = null, wanted = []; const q = { select: () => q, eq: (_k, v) => { owner = v; return q; }, in: (_k, v) => { wanted = v; return q; },
  then: (resolve) => Promise.resolve({ data: owner ? wanted.filter((id) => ids.includes(id)).map((id) => ({ id, ends_at: new Date(Date.now() + 48 * 36e5).toISOString() })) : [], error: null }).then(resolve) }; return q; };
const plain = (value) => JSON.parse(JSON.stringify(value));
const fn = (sql, name) => {
  const start = sql.indexOf(`function public.${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('$$', start) + 2) + 3);
};
// Body-only comparison: drop the create prefix, comments and whitespace.
const normalise = (body) => body.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();

const rules = read('supabase/migrations/20261125100000_m3_notification_rules.sql');
const inbox = read('supabase/migrations/20261117090000_notification_inbox.sql');
const push = read('supabase/migrations/20261116120000_item03_push_notifications.sql');

test('lowest-pillar nudge fires only below 40 or after a 10-point weekly drop of the weakest pillar', () => {
  assert.match(rules, /select mind_score,body_score,bond_score,weakest_pillar,mind_week_change,body_week_change,bond_week_change/);
  assert.match(rules, /pillar_score:=case pillar when 'mind' then scores\.mind_score when 'body' then scores\.body_score when 'bond' then scores\.bond_score end;/);
  assert.match(rules, /pillar_change:=case pillar when 'mind' then scores\.mind_week_change when 'body' then scores\.body_week_change when 'bond' then scores\.bond_week_change end;/);
  assert.match(rules, /if pillar in \('mind','body','bond'\) and \(pillar_score<40 or coalesce\(pillar_change,0\)<=-10\) then daily:='lowest_pillar'; end if;/);
});

test('the inbox context changes only the nudge threshold and trial provider; everything else is identical', () => {
  const before = normalise(fn(inbox, 'item03_inbox_context'));
  let after = normalise(fn(rules, 'item03_inbox_context'));
  const reverted = after
    .replace(' pillar_score numeric; pillar_change numeric;', '')
    .replace('select mind_score,body_score,bond_score,weakest_pillar,mind_week_change,body_week_change,bond_week_change into scores', 'select mind_score,body_score,bond_score,weakest_pillar into scores')
    .replace(/ pillar_score:=case[^;]*end; pillar_change:=case[^;]*end;/, '')
    .replace(" and (pillar_score<40 or coalesce(pillar_change,0)<=-10)", '')
    .replace("s.provider in ('apple','google') and e.provider=s.provider", "s.provider='apple'");
  assert.equal(reverted, before);
  // Quiet hours, one nudge per day and reminder/nudge exclusivity stay in the unchanged caller.
  assert.match(inbox, /create or replace function public\.item03_notification_context/);
  assert.doesNotMatch(rules, /item03_notification_context/);
});

test('day-5 trial notice accepts verified Google Play trials, still after 96 hours and owner-checked', () => {
  assert.match(rules, /check \(provider in \('apple','google'\)\)/);
  assert.match(rules, /s\.provider not in \('apple','google'\)/);
  assert.match(rules, /values\(p_user_id,s\.id,s\.provider,p_environment/);
  assert.match(rules, /at_time>=e\.started_at\+interval '96 hours'/);
  const before = normalise(fn(push, 'record_notification_trial'));
  const reverted = normalise(fn(rules, 'record_notification_trial'))
    .replace("s.provider not in ('apple','google')", "s.provider is distinct from 'apple'")
    .replace('values(p_user_id,s.id,s.provider,', "values(p_user_id,s.id,'apple',")
    .replace(' and provider=s.provider and environment=', ' and environment=');
  assert.equal(reverted, before);
  const store = read('src/lib/native-subscriptions/store.ts');
  assert.match(store, /if \(\(input\.provider === 'apple' \|\| input\.provider === 'google'\) && input\.trialFacts\) \{/);
  assert.match(read('src/lib/native-subscriptions/google.ts'), /trialFacts:\{transactionId:/);
});

test('notification copy is warm and short and keeps every destination', async () => {
  const sent = [];
  const api = load('src/lib/notifications/item03-policy.ts', { './delivery': { sendRateLimitedNotification: async (args) => { sent.push(args.payload); return 'sent'; } } });
  assert.deepEqual(plain(api.pillarPayload('bond')), { type: 'lowest_pillar', heading: 'Tough week for Bond',
    content: "Here's one small thing to try today: some time in Present Dad Mode.", link: '/bond', data: { destination_version: '1', pillar: 'bond' } });
  assert.equal(api.pillarPayload('mind').link, '/mind');
  assert.equal(plain(api.pillarPayload('body').data).workout_id, api.KICK_START_WORKOUT);
  // Same paginated account reader mock as tests/item03Notifications.test.mjs.
  const admin = { from: (table) => { if (table === 'notification_trial_episodes') return trialEnds(['episode-1']); let after = null; const q = { select: () => q, order: () => q, limit: () => q,
    gt: (_key, value) => { after = value; return q; },
    then: (resolve) => Promise.resolve({ data: [{ user_id: 'a' }].filter((r) => after === null || r.user_id > after), error: null }).then(resolve) }; return q; },
    rpc: async () => ({ data: { allowed: true, date: '2026-11-25', timezone: 'Europe/London', dailyType: null, trials: ['episode-1'] } }) };
  await api.dispatchItem03Notifications(admin);
  const trial = plain(sent.find((p) => p.type === 'trial_ending'));
  assert.equal(trial.heading, 'Your trial ends in 2 days');
  assert.equal(trial.data.trial_episode, 'episode-1');
  for (const payload of [trial, plain(api.pillarPayload('mind')), plain(api.pillarPayload('body'))]) {
    assert.ok(payload.heading.length <= 30 && payload.content.length <= 70, payload.heading);
  }
});

const badges = read('supabase/migrations/20261125110000_m3_badge_awarding.sql');

test('the nine brief badges are catalogued once, keyed in place when a matching name exists', () => {
  const keys = [...badges.matchAll(/\('(\w+)','([^']+)','[^']+',\d\)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(keys.map(([key]) => key), ['first_checkin', 'streak_7', 'streak_14', 'streak_30', 'first_workout',
    'first_bond_log', 'first_present_dad', 'first_cook_together', 'first_mini_partners']);
  assert.match(badges, /create unique index if not exists badges_award_key_unique on public\.badges\(award_key\) where award_key is not null;/);
  assert.match(badges, /where b\.award_key is null and lower\(trim\(b\.name\)\)=lower\(c\.name\)/);
  assert.match(badges, /where not exists\(select 1 from public\.badges b where b\.award_key=c\.award_key\)/);
});

test('members can no longer award themselves badges; only server triggers write earned_badges', () => {
  assert.match(badges, /drop policy if exists "Users can CRUD own earned_badges" on public\.earned_badges;/);
  assert.match(badges, /create policy earned_badges_read_own on public\.earned_badges for select to authenticated\s+using \(user_id=\(select auth\.uid\(\)\)\);/);
  assert.match(badges, /revoke insert,update,delete,truncate on public\.earned_badges from public,anon,authenticated;/);
  assert.match(badges, /revoke all on function public\.award_badge\(uuid,text\) from public,anon,authenticated;/);
  assert.match(badges, /revoke all on function public\.award_badges_from_activity\(\) from public,anon,authenticated;/);
  assert.doesNotMatch(badges, /grant execute on function public\.award_badge\(uuid,text\) to authenticated/);
  assert.match(badges, /on conflict\(user_id,badge_id\) do nothing;/);
  assert.match(badges, /exception when others then\s+-- Never fail[^\n]*\n\s+raise warning/);
});

test('each badge is awarded by the action the brief names', () => {
  const triggers = {
    mood_logs: /create trigger award_badges after insert on public\.mood_logs/,
    user_streaks: /create trigger award_badges after insert or update of streak_count on public\.user_streaks\s+for each row when \(coalesce\(new\.streak_count,0\)>=7\)/,
    workout_sessions: /create trigger award_badges after insert on public\.workout_sessions/,
    activity_logs: /create trigger award_badges after insert on public\.activity_logs\s+for each row when \(new\.pillar in \('body','bond'\)\)/,
    bond_logs: /create trigger award_badges after insert on public\.bond_logs/,
    present_dad_sessions: /create trigger award_badges after insert or update of status on public\.present_dad_sessions\s+for each row when \(new\.status='completed'\)/,
  };
  for (const pattern of Object.values(triggers)) assert.match(badges, pattern);
  assert.match(badges, /if tg_table_name='mood_logs' then\s+perform public\.award_badge\(new\.user_id,'first_checkin'\);/);
  for (const n of [7, 14, 30]) assert.match(badges, new RegExp(`if coalesce\\(new\\.streak_count,0\\)>=${n} then perform public\\.award_badge\\(new\\.user_id,'streak_${n}'\\)`));
  assert.match(badges, /if new\.pillar='bond' and new\.activity_type='mini_partners' then\s+perform public\.award_badge\(new\.user_id,'first_mini_partners'\)/);
  assert.match(badges, /if new\.activity_type='cook_together_recipe' then\s+perform public\.award_badge\(new\.user_id,'first_cook_together'\);/);
  assert.match(badges, /if new\.status='completed' and \(tg_op='INSERT' or old\.status is distinct from 'completed'\) then\s+perform public\.award_badge\(new\.user_id,'first_present_dad'\);/);
  // The production cook-together and Mini Partners writers use these exact values.
  assert.match(read('supabase/migrations/20261016160000_cook_together_weekly_access.sql'), /'cook_together_recipe'/);
  assert.match(read('supabase/migrations/20260928140000_manual_activity_logging.sql'), /'mini_partners'/);
});

const streakSql = read('supabase/migrations/20261125120000_m3_streak_reset_date.sql');
const reconciliation = read('supabase/migrations/20261114130000_checkin_streak_reconciliation.sql');

test('streak counting is unchanged; only the last reset day is recorded and returned', () => {
  const before = normalise(fn(reconciliation, 'build_checkin_streak'));
  const reverted = normalise(fn(streakSql, 'build_checkin_streak'))
    .replace(' reset_day date;', '')
    .replace("else if n>0 then reset_day:=day; end if; n:=0; end if;", 'else n:=0; end if;')
    .replace(",'resetOn',reset_day);", ');');
  assert.equal(reverted, before);
  const applyBefore = normalise(fn(reconciliation, 'apply_checkin_streak'));
  const applyReverted = normalise(fn(streakSql, 'apply_checkin_streak'))
    .replace(",observed_at=observed, last_reset_date=case when result->>'state'='current' then (result->>'resetOn')::date else last_reset_date end", ',observed_at=observed');
  assert.equal(applyReverted, applyBefore);
  assert.match(streakSql, /alter table public\.streak_reconciliation_state add column if not exists last_reset_date date;/);
  assert.match(streakSql, /result:=public\.read_checkin_streak_status_before_item02\(p_user_id\); -- retains owner check/);
  assert.match(streakSql, /'resetOn',case when result->>'state'='current'/);
});

test('streak API passes a valid reset day through and rejects malformed ones', async () => {
  const { readStreakStatus } = load('src/lib/streaks/status.ts');
  const row = { state: 'current', count: 2, lastKnownCount: 2, reconciledThrough: '2026-11-24', protectedDates: [], allowance: 0,
    currentDate: '2026-11-25', weekStart: '2026-11-23', calendarDays: ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'] };
  const read = (data) => readStreakStatus({ rpc: async () => ({ data, error: null }) }, 'owner');
  assert.equal((await read({ ...row, resetOn: '2026-11-23' })).streak.resetOn, '2026-11-23');
  assert.equal((await read(row)).streak.resetOn, null, 'older databases omit the field');
  assert.equal((await read({ ...row, resetOn: 'yesterday' })).state, 'unavailable');
});

test('mind plan failures log a sanitised cause; the member response is unchanged', async () => {
  const logs = [];
  const { operateMindPlan } = load('src/lib/mind/plan.ts', {}, logs);
  const owner = '00000000-0000-4000-8000-000000000001';
  const run = (result) => operateMindPlan({ rpc: async () => result }, owner, 'read');
  assert.deepEqual(plain(await run({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } })), { state: 'unavailable', reason: 'plan_unavailable' });
  assert.deepEqual(plain(await run({ data: null, error: null })), { state: 'unavailable', reason: 'plan_unavailable' });
  await run({ data: { state: 'unavailable', reason: 'access_unknown' }, error: null });
  await run({ data: { state: 'available', plan: {} }, error: null });
  assert.deepEqual(logs.map(([, detail]) => detail), [
    { operation: 'read', cause: 'rpc_error', code: '57014' },
    { operation: 'read', cause: 'empty_response' },
    { operation: 'read', cause: 'server_unavailable', code: 'access_unknown' },
    { operation: 'read', cause: 'invalid_shape', code: 'available' },
  ]);
  assert.ok(!JSON.stringify(logs).includes(owner), 'the member id is never logged');
  assert.ok(!JSON.stringify(logs).includes('statement timeout'), 'database messages are not logged');
  assert.match(read('src/lib/mind/plan-api.ts'), /catch \{ logPlanFailure\(operation, 'route_exception'\); return json/);
});

test('dispatcher reads each account context once per run, keeps daily-before-trial order and error counts', async () => {
  const sent = [];
  const api = load('src/lib/notifications/item03-policy.ts', { './delivery': { sendRateLimitedNotification: async (args) => { sent.push(`${args.type}:${args.userId}`); return 'sent'; } } });
  const rows = [{ user_id: 'a' }, { user_id: 'b' }, { user_id: 'c' }];
  const reads = [];
  const admin = {
    from: (table) => { if (table === 'notification_trial_episodes') return trialEnds(['t-a', 't-b']); let after = null; const q = { select: () => q, order: () => q, limit: () => q, gt: (_k, v) => { after = v; return q; },
      then: (resolve) => Promise.resolve({ data: rows.filter((r) => after === null || r.user_id > after), error: null }).then(resolve) }; return q; },
    rpc: async (name, args) => {
      reads.push(args.p_user_id);
      if (args.p_user_id === 'c') return { data: null, error: { code: '57014' } };
      return { data: { allowed: true, date: '2026-11-25', timezone: 'Europe/London', dailyType: 'morning_checkin', trials: ['t-' + args.p_user_id] }, error: null };
    },
  };
  const totals = plain(await api.dispatchItem03Notifications(admin));
  assert.deepEqual(reads, ['a', 'b', 'c'], 'one context read per account (previously two)');
  assert.deepEqual(sent, ['morning_checkin:a', 'morning_checkin:b', 'trial_ending:a', 'trial_ending:b'], 'all daily work before any trial');
  assert.deepEqual(totals, { sent: 4, errors: 2 }, 'a failed account still counts once per pass');
});
