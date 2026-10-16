import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const route = await readFile(new URL('../src/app/api/admin/weekly-recipe/route.ts', import.meta.url), 'utf8');
const admin = await readFile(new URL('../src/app/admin/page.tsx', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261016160000_cook_together_weekly_access.sql', import.meta.url), 'utf8');

test('weekly recipe API uses Admin session and existing service-role scheduling RPC', () => {
  assert.match(route, /verifyAdmin\(\)/);
  assert.match(route, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(route, /admin_set_free_weekly_recipe/);
  assert.match(route, /parsedDate\.getUTCDay\(\) !== 1/);
  assert.match(route, /week_start.*recipe_id/);
  assert.match(migration, /p_week_start < current_week_start/);
});

test('weekly recipe API loads schedules without PostgREST relationship joins', () => {
  assert.match(route, /from\("free_weekly_recipe_assignments"\)[\s\S]*?select\("week_start, recipe_id"\)/);
  assert.doesNotMatch(route, /recipes\(title\)/);
  assert.match(route, /recipeTitles\.get\(row\.recipe_id\)/);
  assert.match(route, /\.gte\("week_start", currentMondayDateUtc\(\)\)/);
});

test('Recipe Manager exposes current and future weekly scheduling', () => {
  assert.match(admin, /Free weekly Cook Together recipe/);
  assert.match(admin, /featured-recipe-week-start/);
  assert.match(admin, /Schedule recipe/);
  assert.match(admin, /weekly-recipe/);
  assert.match(admin, /Week of \{assignment\.week_start\}/);
  assert.match(admin, /No weekly Cook Together recipes scheduled yet\./);
});

test('weekly recipe selector only offers existing Cook Together recipes', () => {
  assert.match(admin, /items\.filter\(\(item\) => item\.cook_together\)/);
});
