// Opt-in isolated scoring proof (client audit A1). Runs the production scoring functions,
// copied verbatim and fingerprint-matched on 26 Nov 2026, plus migration 20261126100000 (step 09),
// on an in-process PostgreSQL (PGlite). Never connects to any server or production database.
//   npm i --no-save @electric-sql/pglite@0.2 && node --test tests/scoringParity.database.mjs
// LEGACY=1 reproduces the pre-step-09 missing-data defect (expected to fail its 10 related checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let available = true;
try { await import('@electric-sql/pglite'); } catch { available = false; }

test('Body/Mind/Bond scoring parity, caps, duplicates, isolation and full-week 100 on the live functions', { skip: !available && 'PGlite not installed (opt-in)' }, () => {
  const harness = fileURLToPath(new URL('./fixtures/scoring/scoring_matrix.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [harness], { encoding: 'utf8', env: { ...process.env } });
  const failures = run.stdout.split('\n').filter((line) => line.startsWith('FAIL'));
  assert.deepEqual(failures, [], run.stdout + run.stderr);
  assert.match(run.stdout, /ALL PASSED/);
  assert.ok((run.stdout.match(/^PASS /gm) ?? []).length >= 30, 'all scoring checks ran');
});
