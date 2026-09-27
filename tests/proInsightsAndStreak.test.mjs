import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Pro insight endpoint checks the canonical entitlement before returning every derived output', async () => {
  const route = await read('src/app/api/pro/insights/route.ts');
  const gate = route.indexOf('if (!subscription.isPro)');
  for (const kind of ['score-history', 'mood-correlation', 'weekly-report', 'monthly-report']) {
    assert.ok(route.includes(`kind === "${kind}"`));
    assert.ok(route.indexOf(`kind === "${kind}"`) > gate);
  }
  assert.match(route, /getSubscriptionSummary\(context\.admin, context\.userId\)/);
});

test('history view privilege migration closes direct client access and retains service access', async () => {
  const migration = await read('supabase/migrations/20260927120000_canonical_pro_insights_and_streak_freeze.sql');
  assert.match(migration, /revoke all on table public\.dad_score_history_view from anon, authenticated/);
  assert.match(migration, /grant select on table public\.dad_score_history_view to service_role/);
  assert.match(migration, /revoke all on table public\.user_streak_freezes from public, anon, authenticated/);
  assert.match(migration, /alter table public\.user_streaks enable row level security/);
});

test('streak function is retry-safe, date-based, Pro-only for freezes, and unique per week', async () => {
  const migration = await read('supabase/migrations/20260927120000_canonical_pro_insights_and_streak_freeze.sql');
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('streak:' \|\| p_user_id::text, 0\)\)/);
  assert.match(migration, /p_activity_date <= previous_activity\) then\s+return current_count/);
  assert.match(migration, /gap_days = 2[\s\S]*?user_has_pro_access\(p_user_id\)/);
  assert.match(migration, /primary key \(user_id, week_start\)/);
  assert.match(migration, /on conflict \(user_id, week_start\) do nothing/);
  assert.match(migration, /freeze_recorded then current_count \+ 1 else 1/);
  assert.match(migration, /revoke insert, update, delete on table public\.user_streaks from anon, authenticated/);
  assert.match(migration, /after insert or update or delete on public\.mood_logs/);
});

test('Pro pattern and freeze status share the database score-history week boundary', async () => {
  const [store, insights, status] = await Promise.all([
    read('src/lib/native-subscriptions/store.ts'),
    read('src/app/api/pro/insights/route.ts'),
    read('src/app/api/native-subscriptions/status/route.ts'),
  ]);
  assert.match(store, /from\("dad_score_history_view"\)[\s\S]*?order\("week_start", \{ ascending: false \}\)/);
  assert.match(store, /from\("user_streak_freezes"\)[\s\S]*?eq\("week_start", weekStart\)/);
  assert.match(insights, /getCanonicalWeekStart\(context\.admin, context\.userId\)/);
  assert.doesNotMatch(insights, /function mondayStart|Date\.UTC\(date\.getUTCFullYear/);
  assert.match(status, /summary\.isPro[\s\S]*?getCurrentWeekFreezeState/);
  assert.match(status, /freezesRemaining: 0/);
});
