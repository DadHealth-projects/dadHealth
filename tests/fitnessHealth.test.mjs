import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('AI workout generation requires canonical Pro entitlement and preserves generated-workout writes', async () => {
  const [source, summary, accessRules] = await Promise.all([
    read('src/app/api/generate-workout/route.ts'),
    read('src/lib/native-subscriptions/store.ts'),
    read('src/lib/native-subscriptions/types.ts'),
  ]);
  assert.match(source, /getSubscriptionSummary\(admin, user\.id\)/);
  assert.match(source, /if \(!isPro\)[\s\S]*?"pro_required"[\s\S]*?403/);
  assert.match(source, /source: "ai_generated"/);
  assert.match(source, /from\("workouts"\)[\s\S]*?\.insert\(/);
  assert.match(source, /durationMins: durationMins/);
  assert.match(source, /equipment,/);
  assert.match(source, /focus,/);
  assert.doesNotMatch(source, /isProfilePro|FREE_MONTHLY_GENERATIONS|claim_ai_workout_generation|complete_ai_workout_generation|free_limit_reached/);
  assert.match(summary, /rpc\("user_has_pro_access"/);
  assert.match(summary, /const isPro = canonicalProAccess === true/);
  assert.match(accessRules, /"active", "trialing", "grace_period"/);
});

test('Meal Planner enforces canonical Pro entitlement and keeps saved-plan reads user-scoped', async () => {
  const source = await read('src/app/api/generate-meal-plan/route.ts');
  assert.match(source, /export async function GET/);
  assert.match(source, /\.eq\('user_id', user\.id\)[\s\S]*?\.eq\('source', 'ai_generated'\)/);
  assert.match(source, /savedPlan: data \?\? null/);
  assert.match(source, /getSubscriptionSummary\(createAdminSupabaseClient\(\), user\.id\)/);
  assert.match(source, /if \(!isPro\)[\s\S]*?code: 'pro_required'[\s\S]*?status: 403/);
  assert.match(source, /source: 'ai_generated'/);
  assert.doesNotMatch(source, /FREE_AI_MEAL_PLANS|meal_plan_limit_reached|free meal plans/i);
});
