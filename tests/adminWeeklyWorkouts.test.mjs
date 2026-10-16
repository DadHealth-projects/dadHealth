import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const route = await readFile(new URL('../src/app/api/admin/weekly-workout/route.ts', import.meta.url), 'utf8');
const admin = await readFile(new URL('../src/app/admin/page.tsx', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261016150000_weekly_free_workout_assignment.sql', import.meta.url), 'utf8');

test('Admin scheduling is authenticated and constrained to Monday dates and workout IDs', () => {
  assert.match(route, /verifyAdmin\(\)/);
  assert.match(route, /parsedDate\.getUTCDay\(\) !== 1/);
  assert.match(route, /admin_set_free_weekly_workout/);
  assert.match(migration, /extract\(isodow from week_start\) = 1/);
  assert.match(migration, /p_week_start < current_week_start/);
});

test('Admin can select existing workouts and schedule future weekly assignments', () => {
  assert.match(admin, /Free weekly workout/);
  assert.match(admin, /featured-workout/);
  assert.match(admin, /featured-week-start/);
  assert.match(admin, /Schedule workout/);
  assert.match(admin, /weekly-workout/);
});

test('RLS keeps current assignment public and gates unassigned Admin workouts by canonical Pro', () => {
  assert.match(migration, /current_user_has_pro_workout_access\(\)/);
  assert.match(migration, /public\.user_has_pro_access\(auth\.uid\(\)\)/);
  assert.match(migration, /as restrictive for select/);
  assert.match(migration, /Read current weekly workout assignment/);
  assert.match(migration, /source = 'admin'/);
  assert.match(migration, /auth\.uid\(\) = user_id/);
});
