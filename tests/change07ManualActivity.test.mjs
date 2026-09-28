import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('manual activity storage is owner-scoped, date-validated, and retry-safe', async () => {
  const sql = await read('supabase/migrations/20260928140000_manual_activity_logging.sql');
  assert.match(sql, /create table if not exists public\.activity_logs/);
  for (const column of ['user_id', 'pillar', 'activity_type', 'duration_minutes', 'intensity', 'contact_day', 'notes', 'activity_date', 'logged_at', 'backdated_at', 'client_request_id']) {
    assert.match(sql, new RegExp(`\\b${column}\\b`));
  }
  assert.match(sql, /unique \(user_id, client_request_id\)/);
  assert.match(sql, /auth\.uid\(\) = user_id/);
  assert.match(sql, /activity_date < utc_today - 7/);
  assert.match(sql, /activity_date > utc_today/);
  assert.match(sql, /new\.logged_at := now\(\)/);
  assert.match(sql, /new\.backdated_at := case/);
});

test('canonical manual points follow the approved Body, Mind and Bond rules', async () => {
  const sql = await read('supabase/migrations/20260928140000_manual_activity_logging.sql');
  assert.match(sql, /when a\.intensity = 'light' and a\.duration_minutes < 30 then 2/);
  assert.match(sql, /when a\.intensity = 'light' then 4/);
  assert.match(sql, /when a\.intensity = 'moderate' and a\.duration_minutes < 60 then 6/);
  assert.match(sql, /when a\.intensity = 'hard' and a\.duration_minutes < 60 then 8/);
  assert.match(sql, /when a\.intensity = 'hard' then 10/);
  assert.match(sql, /when a\.duration_minutes < 5 then 0[\s\S]*?category = 'professional_support' then 8/);
  assert.match(sql, /when a\.category in \('routine', 'remote'\) then case when a\.duration_minutes >= 45 then 6 else 4 end/);
  const bondScoring = sql.split("select a.user_id, a.activity_date, 'bond'::text as pillar,")[1].split('union all')[0];
  assert.match(bondScoring, /when a\.duration_minutes is not null and a\.duration_minutes < 15 then 0[\s\S]*?when a\.activity_type = 'mini_partners' then 8[\s\S]*?when a\.category in \('play', 'active', 'out_and_about'\)/);
  assert.doesNotMatch(bondScoring, /then case when a\.duration_minutes >= 45 then 10 else 8 end/);
  assert.match(sql, /when a\.category = 'other' then case when a\.duration_minutes >= 45 then 4 else 2 end/);
  assert.match(sql, /select distinct on \(c\.user_id, c\.pillar, c\.activity_date\)/);
  assert.match(sql, /least\(70, coalesce\(sum\(w\.points\)/);
  assert.match(sql, /mind_score := least\(100, greatest\(0, coalesce\(v_nonmanual\.mind_score, 0\)\) \* 0\.30/);
});

test('closed historical periods retain the old score model and transition trends are omitted', async () => {
  const sql = await read('supabase/migrations/20260928140000_manual_activity_logging.sql');
  const history = await read('supabase/migrations/20260925120000_score_detail_canonical_fields.sql');
  assert.match(sql, /if p_start_date < v_effective_week then[\s\S]*?mind_score := v_nonmanual\.mind_score/);
  assert.match(sql, /current_week\.week_start > score_config\.effective_week_start/);
  assert.match(history, /create or replace view public\.dad_score_history_view/);
  assert.match(history, /public\.calculate_dad_score_period\(/);
});

test('derived manual trends use the authenticated Pro insights boundary', async () => {
  const route = await read('src/app/api/pro/insights/route.ts');
  const mobile = await read('supabase/migrations/20260928140000_manual_activity_logging.sql');
  const proGate = route.indexOf('if (!subscription.isPro)');
  const manualBranch = route.indexOf('kind === "manual-activity-trends"');
  assert.ok(proGate >= 0 && manualBranch > proGate);
  assert.match(route, /from\("dad_manual_activity_history_view"\)/);
  assert.match(mobile, /revoke all on public\.dad_manual_activity_history_view from public, anon, authenticated/);
  assert.match(mobile, /grant select on public\.dad_manual_activity_history_view to service_role/);
});

test('database behavior tests cover score, access, history and validation', async () => {
  const sqlTest = await read('supabase/tests/change_07_manual_activity_logging.test.sql');
  assert.match(sqlTest, /seven daily Maximum Body logs cap at 70 points/);
  assert.match(sqlTest, /one Mini Partners row contributes Strong points to Body/);
  assert.match(sqlTest, /same Mini Partners row contributes Strong points to Bond/);
  assert.match(sqlTest, /'bond', 'other', 'other', 'Family activity', 10, false/);
  assert.match(sqlTest, /'bond', 'active', 'mini_partners', 90, true/);
  assert.match(sqlTest, /closed historical week retains pre-Change-07 scoring semantics/);
  assert.match(sqlTest, /future activity dates are rejected by the database/);
  assert.match(sqlTest, /activity dates older than seven days are rejected by the database/);
});
