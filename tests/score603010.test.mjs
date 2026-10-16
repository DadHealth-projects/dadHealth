import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20261016120000_pillar_score_60_40_10_30.sql', import.meta.url), 'utf8');
const sqlRegression = readFileSync(new URL('../supabase/tests/score_60_40_10_30.test.sql', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/app/api/pro/insights/route.ts', import.meta.url), 'utf8');

test('Mind 60/40 and Body/Bond 60/10/30 migration versions Monday scoring without rewriting closed weeks', () => {
  assert.match(migration, /effective_week_start date not null check \(extract\(isodow from effective_week_start\) = 1\)/);
  assert.match(migration, /date_trunc\('week', current_date\)::date \+ 7, 60, 40, 10, 30/);
  assert.match(migration, /if p_start_date < v_change_07_week then[\s\S]*?return next;[\s\S]*?return;/);
  assert.match(migration, /if p_start_date < v_model_effective_week then[\s\S]*?0\.30 \+ coalesce\(v_manual\.mind_manual_points, 0\)/);
  assert.match(migration, /coalesce\(v_manual\.mind_manual_points, 0\) \* v_manual_weight \/ 70\.0/);
  assert.match(migration, /count\(distinct m\.date\)::integer into v_mind_checkin_days/);
  assert.match(migration, /least\(coalesce\(v_mind_checkin_days, 0\), 7\) \* v_mind_checkin_weight \/ 7\.0/);
  assert.match(migration, /greatest\(0, coalesce\(v_nonmanual\.body_score, 0\)\) \* v_other_weight \/ 100\.0/);
  assert.match(migration, /greatest\(0, coalesce\(v_nonmanual\.bond_score, 0\)\) \* v_other_weight \/ 100\.0/);
});

test('Mind participation is proportional by check-in day; Body/Bond participation checks presence only', () => {
  assert.match(migration, /count\(distinct m\.date\)::integer into v_mind_checkin_days[\s\S]*?m\.mood_value is not null/);
  const participation = migration.match(/select\s+exists \([\s\S]*?\) as body_completed,[\s\S]*?\) as bond_completed[\s\S]*?into v_checkins;/)?.[0];
  assert.ok(participation, 'Body and Bond participation queries exist');
  assert.match(participation, /m\.energy_level is not null/);
  assert.match(participation, /m\.connection_level is not null/);
  assert.doesNotMatch(migration, /stress_level\s*[<>=]|mood_value\s*[<>=]\s*\d|energy_level\s*[<>=]\s*\d|connection_level\s*[<>=]\s*\d/);
});

test('score history labels models and API returns one model at a time', () => {
  assert.match(migration, /as score_model_version/);
  assert.match(migration, /current_week\.week_start > greatest\(score_config\.effective_week_start, model_config\.effective_week_start\)/);
  assert.match(api, /score_model_version/);
  assert.match(api, /point\.score_model_version === latestModelVersion/);
});

test('SQL regression fixture covers pillars, difficult answers, missing check-ins, Mini Partners and history', () => {
  assert.match(sqlRegression, /select plan\(19\)/);
  for (const phrase of [
    'one low Mind check-in earns 40/7 participation points',
    'three of seven low-answer days earn exactly three-sevenths of Mind participation credit',
    'seven low-answer days earn the full 40 Mind participation points',
    'Energy participation',
    'Connection participation',
    'missing Mind check-in earns no participation points',
    'Mini Partners',
    'pre-Change 07 historical formula remains unchanged',
    'trend resumes when adjacent weeks both use same formula',
  ]) assert.ok(sqlRegression.includes(phrase), `missing SQL case: ${phrase}`);
});
