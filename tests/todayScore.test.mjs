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

function canonicalMindScore(moodValue, stressLevel, scaleVersion) {
  const normalizedMood = moodValue - (scaleVersion === 1 ? 1 : 0);
  const moodScore = normalizedMood * 25;
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

test('canonical-score migration preserves legacy mood data and maps both scales equivalently', async () => {
  const migration = await source('supabase/migrations/20260925120000_score_detail_canonical_fields.sql');

  assert.match(migration, /add column if not exists mood_scale_version smallint not null default 0/);
  assert.match(migration, /mood_scale_version = 0 and mood_value between 0 and 4/);
  assert.match(migration, /mood_scale_version = 1 and mood_value between 1 and 5/);
  assert.doesNotMatch(migration, /update public\.mood_logs|delete from public\.mood_logs|truncate public\.mood_logs/i);
  for (let legacy = 0; legacy <= 4; legacy += 1) {
    assert.equal(canonicalMindScore(legacy, null, 0), canonicalMindScore(legacy + 1, null, 1));
    for (let stress = 1; stress <= 5; stress += 1) {
      assert.equal(canonicalMindScore(legacy, stress, 0), canonicalMindScore(legacy + 1, stress, 1));
    }
  }
});

test('canonical score and trend views use complete Monday-to-Sunday weeks', async () => {
  const migration = await source('supabase/migrations/20260925120000_score_detail_canonical_fields.sql');
  const monday = /date_trunc\('week', current_date\)::date/;

  assert.match(migration, new RegExp(`${monday.source}[\\s\\S]*\\+ 7`));
  assert.match(migration, new RegExp(`${monday.source}[\\s\\S]*- 7`));
  assert.match(migration, /weeks\.week_start[\s\S]*weeks\.week_start \+ 7/);
  assert.match(migration, /current_scores\.mind_score - previous_scores\.mind_score/);
  assert.match(migration, /current_scores\.body_score - previous_scores\.body_score/);
  assert.match(migration, /current_scores\.bond_score - previous_scores\.bond_score/);
});

test('recommended action skips recorded activities completed today', async () => {
  const migration = await source('supabase/migrations/20260925120000_score_detail_canonical_fields.sql');

  assert.match(migration, /then 'checkin'::text/);
  assert.match(migration, /from public\.workout_sessions w[\s\S]*w\.performed_at >= current_date::timestamptz/);
  assert.match(migration, /from public\.journal_entries j[\s\S]*j\.created_at >= current_date::timestamptz/);
  assert.match(migration, /from public\.bond_logs bl[\s\S]*bl\.created_at >= current_date::timestamptz/);
  assert.match(migration, /from public\.present_dad_sessions pds[\s\S]*pds\.status = 'completed'[\s\S]*pds\.completed_at >= current_date::timestamptz/);
  assert.match(migration, /no persisted breathing-completion record/i);
});
