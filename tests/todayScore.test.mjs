import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

function dailyMindScore(moodValue, stressLevel) {
  const moodScore = moodValue * 25;
  return stressLevel == null
    ? moodScore
    : (moodScore + (5 - stressLevel) * 25) / 2;
}

test('stress extends the existing Mind score and preserves legacy check-ins', () => {
  assert.equal(dailyMindScore(3, null), 75);
  assert.equal(dailyMindScore(3, 1), 87.5);
  assert.equal(dailyMindScore(3, 5), 37.5);
  assert.ok(dailyMindScore(3, 1) > dailyMindScore(3, 5));
});

test('targeted migration adds constrained stress without changing mood ownership', async () => {
  const [migration, policies] = await Promise.all([
    source('supabase/migrations/20260901090000_today_score_model.sql'),
    source('supabase/rls-policies.sql'),
  ]);

  assert.match(migration, /add column if not exists stress_level smallint/);
  assert.match(migration, /check \(stress_level between 1 and 5\)/);
  assert.match(migration, /when m\.stress_level is null then m\.mood_value \* 25\.0/);
  assert.match(migration, /\(\(m\.mood_value \* 25\.0\) \+ \(\(5 - m\.stress_level\) \* 25\.0\)\) \/ 2\.0/);
  assert.match(policies, /Users can CRUD own mood_logs/);
  assert.equal(migration.includes('create policy'), false);
});

test('score periods are seven days, adjacent, and non-overlapping', async () => {
  const migration = await source('supabase/migrations/20260901090000_today_score_model.sql');

  assert.match(migration, /current_date - 6,[\s\S]*current_date \+ 1,[\s\S]*now\(\) - interval '7 days',[\s\S]*now\(\)/);
  assert.match(migration, /current_date - 13,[\s\S]*current_date - 6,[\s\S]*now\(\) - interval '14 days',[\s\S]*now\(\) - interval '7 days'/);
  assert.match(migration, /m\.date >= p_start_date[\s\S]*m\.date < p_end_date/);
  assert.match(migration, /performed_at >= p_start_time[\s\S]*performed_at < p_end_time/);
});

test('trends expose previous scores only when the previous pillar has data', async () => {
  const migration = await source('supabase/migrations/20260901090000_today_score_model.sql');

  for (const pillar of ['mind', 'body', 'bond']) {
    assert.ok(migration.includes(`previous_${pillar}_score`));
    assert.ok(migration.includes(`${pillar}_week_change`));
    assert.ok(migration.includes(`previous_scores.${pillar}_has_data then current_scores.${pillar}_score - previous_scores.${pillar}_score`));
  }
});

test('one completed Present Dad session contributes once without synthetic Bond rows', async () => {
  const migration = await source('supabase/migrations/20260901090000_today_score_model.sql');

  assert.match(migration, /from public\.present_dad_sessions pds/);
  assert.match(migration, /pds\.status = 'completed'/);
  assert.match(migration, /pds\.completed_at >= p_start_time/);
  assert.match(migration, /select count\(\*\) \* 15[\s\S]*from public\.present_dad_sessions/);
  assert.equal(migration.includes('insert into public.bond_logs'), false);
});

test('period calculation and score view retain invoker security', async () => {
  const migration = await source('supabase/migrations/20260901090000_today_score_model.sql');

  assert.match(migration, /security invoker/);
  assert.match(migration, /with \(security_invoker = true\)/);
  assert.match(migration, /revoke all on function public\.calculate_dad_score_period/);
  assert.match(migration, /grant execute on function public\.calculate_dad_score_period[\s\S]*to authenticated, service_role/);
  assert.doesNotMatch(migration, /to anon, authenticated, service_role/);
});
