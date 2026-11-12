import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const next = read('../supabase/migrations/20261111120000_mind_participation_and_scoring_calendar.sql');
const old = read('../supabase/migrations/20261016120000_pillar_score_60_40_10_30.sql');
const definition = (sql, name) => sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))?.[0];

test('historical calculation is preserved byte-for-byte apart from function name', () => {
  assert.equal(definition(next, 'calculate_dad_score_period_pre_phase2').replace('_pre_phase2(', '('), definition(old, 'calculate_dad_score_period'));
});

test('current and history view column contracts stay unchanged', () => {
  for (const name of ['dad_score_view', 'dad_score_history_view']) {
    const columns = sql => sql.match(new RegExp(`create or replace view public\\.${name}[\\s\\S]*?from public.user_profile`))[0]
      .match(/\bas (previous_\w+|\w+_week_change|total_score|weakest_pillar|recommended_action|baseline_available|score_model_version|bond_score)\b/g);
    assert.deepEqual(columns(next), columns(old));
  }
});

test('schema snapshot contains exact forward migration; activation stays prospective', () => {
  assert.ok(read('../supabase/schema.sql').includes(next.replace(/^begin;\n/, '').replace(/commit;\s*$/, '').trim()));
  assert.match(next, /interval '14 days'/);
  assert.match(next, /on conflict \(model_version\) do nothing/);
  assert.match(next, /p_start_date < config.effective_week_start/);
});

test('new credit tables deny direct authenticated writes; RPC derives owner', () => {
  assert.match(next, /revoke all on public.mind_reset_sessions from public, anon, authenticated/);
  assert.match(definition(next, 'complete_mind_reset'), /uid uuid := auth.uid\(\)/);
  assert.match(definition(next, 'complete_mind_reset'), /mind_reset_owner_mismatch/);
  assert.match(definition(next, 'calculate_mind_activity_points_v2'), /max\(points\)/);
});

test('forward migration has one definition per object and one transaction', () => {
  const objects = [...next.matchAll(/create (?:or replace )?(?:table if not exists|view|function) public\.(\w+)/g)].map(match => match[1]);
  assert.equal(new Set(objects).size, objects.length);
  assert.equal((next.match(/^begin;$/gm) ?? []).length, 1);
  assert.equal((next.match(/^commit;$/gm) ?? []).length, 1);
  // Structural guard only: actual PostgreSQL parsing/execution is a release gate.
  const functions = [...next.matchAll(/create or replace function public\.(\w+)/g)].map(match => match[1]);
  for (const name of functions) assert.ok(definition(next, name), `${name} has a complete dollar-quoted body`);
});

test('history uses account weeks without rewriting date-only sources', () => {
  const view = next.match(/create or replace view public\.dad_manual_activity_history_view[\s\S]*?grant select[^;]+;/)[0];
  assert.match(view, /scoring_current_date\(p.user_id\)/);
  assert.match(view, /calculate_manual_activity_period/);
  assert.doesNotMatch(next, /update public\.(mood_logs|activity_logs|journal_entries)\s+set/i);
  assert.match(definition(next, 'get_scoring_calendar'), /isfinite\(effective_at\)/);
  assert.match(definition(next, 'capture_scoring_timezone'), /effective_at>now\(\)/);
  assert.match(definition(next, 'scoring_current_date'), /least\(current_date, effective_day - 1\)/);
});
