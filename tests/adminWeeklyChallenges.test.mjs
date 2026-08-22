import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("Weekly Challenge admin supports content editing and explicit active states", async () => {
  const page = await source("src/app/admin/page.tsx");

  for (const expected of [
    'function ChallengesTab()',
    'editId ? "Edit Challenge" : "Create Challenge"',
    'editId ? "Update Challenge" : "Create Challenge"',
    'item.active ? "Shown in Dad Health" : "Not currently shown"',
    'item.active ? "Deactivate" : "Make active"',
    'role="alert"',
    'Weekly challenges could not be loaded. Please try again.',
    'This weekly challenge could not be updated. Please try again.',
    'This weekly challenge could not be made active. Please try again.',
    'This weekly challenge could not be deleted. Please try again.',
    'Enter the challenge instruction before saving.',
    'Create a new challenge for each week; editing an existing challenge keeps its participation history.',
    'Its participation and completion history will also be removed.',
  ]) {
    assert.ok(page.includes(expected), `Missing Weekly Challenge admin contract: ${expected}`);
  }

  assert.equal(page.includes("dads checked in since launch"), false);
  assert.equal(page.includes("Active immediately"), false);
});

test("Weekly Challenge API has strict content, active-state, and delete allowlists", async () => {
  const route = await source("src/app/api/admin/[resource]/route.ts");

  assert.match(route, /const allowedKeys = new Set\(requireId \? \["id", "title", "description"\] : \["title", "description"\]\)/);
  assert.match(route, /const allowedKeys = new Set\(\["id", "active"\]\)/);
  assert.match(route, /Only the challenge ID can be supplied when deleting\./);
  assert.match(route, /\.select\("id, title, description, active, created_at"\)/);
  assert.match(route, /\.rpc\("set_active_weekly_challenge", \{[\s\S]*?p_challenge_id: parsed\.id,[\s\S]*?p_active: parsed\.active/);
  assert.match(route, /case "challenges": \{[\s\S]*?parseChallengeWrite\(body, false\)[\s\S]*?active: false/);
  assert.ok(route.includes('Challenge description is required.'));
  assert.equal(route.includes('challenges: "weekly_challenges"'), false);
  assert.equal(route.includes('participants_count: countMap'), false);
});

test("single-active schema contract is concurrency-safe and service-role-only", async () => {
  const schema = await source("supabase/schema.sql");

  for (const expected of [
    "weekly_challenges_single_active_idx",
    "ranked_active",
    "active_position > 1",
    "where active is true",
    "public.set_active_weekly_challenge",
    "pg_advisory_xact_lock",
    "hashtextextended('public.weekly_challenges.single_active', 0)",
    "set active = false",
    "set active = p_active",
    "from public, anon, authenticated",
    "to service_role",
  ]) {
    assert.ok(schema.includes(expected), `Missing single-active schema contract: ${expected}`);
  }
});

test("Weekly Challenge participation and completion are deduplicated, counted, and owner-scoped", async () => {
  const [schema, policies, regression] = await Promise.all([
    source("supabase/schema.sql"),
    source("supabase/rls-policies.sql"),
    source("supabase/tests/weekly_challenges_rls_test.sql"),
  ]);
  const weeklySchema = schema.slice(
    schema.indexOf("create table if not exists public.weekly_challenge_participants"),
    schema.indexOf("-- meal_plans"),
  );

  for (const expected of [
    "create table if not exists public.weekly_challenge_participants",
    "primary key (challenge_id, user_id)",
    "sync_weekly_challenge_participant_count",
    "set participants_count = participants_count + 1",
    "set participants_count = greatest(participants_count - 1, 0)",
    'create policy "Clients can read active weekly challenge"',
    "using (active is true)",
    'create policy "Users can join active weekly challenge"',
    'create policy "Users can leave own weekly challenge"',
    "completed_at timestamptz",
    "public.complete_weekly_challenge",
    "challenge_not_active",
    "challenge_not_joined",
    "and completed_at is null",
  ]) {
    assert.ok(schema.includes(expected), `Schema is missing Weekly Challenge contract: ${expected}`);
  }

  for (const expected of [
    'create policy "Clients can read active weekly challenge"',
    "grant insert (challenge_id, user_id)",
    "public.complete_weekly_challenge",
    'create policy "Users can read own weekly challenge participation"',
    'create policy "Users can join active weekly challenge"',
    'create policy "Users can leave own weekly challenge"',
  ]) {
    assert.ok(policies.includes(expected), `RLS policy file is missing: ${expected}`);
  }

  for (const expected of [
    "anonymous clients see only the active challenge",
    "authenticated clients see only the active challenge",
    "the same user cannot join the same challenge twice",
    "joining increments the participant count",
    "leaving decrements the participant count",
    "duplicate completion returns the original completion timestamp",
    "completed participation cannot be removed",
    "activating a new challenge preserves old participation history",
    "activating a new challenge preserves old completion history",
    "the same user can join a new weekly challenge independently",
    "authenticated clients cannot execute the activation RPC",
    "the activation RPC leaves exactly one active challenge",
  ]) {
    assert.ok(regression.includes(expected), `Missing Weekly Challenge role regression: ${expected}`);
  }
  assert.equal(weeklySchema.includes("started_at"), false);
  assert.equal(schema.includes("start_weekly_challenge"), false);
  assert.equal(policies.includes("start_weekly_challenge"), false);
  assert.equal(schema.includes("challenge_progress"), false);
});

test("web Home stays compact and opens the dedicated Weekly Challenge screen", async () => {
  const [hook, dashboard, home, types, challengeScreen] = await Promise.all([
    source("src/hooks/useDashboard.ts"),
    source("src/components/home/DashboardPreview.tsx"),
    source("src/components/home/dashboardPreview/HomeScreen.tsx"),
    source("src/components/home/dashboardPreview/types.ts"),
    source("src/components/home/dashboardPreview/WeeklyChallengeScreen.tsx"),
  ]);

  assert.ok(hook.includes('.select("id, title, description, participants_count")'));
  assert.ok(hook.includes('.from("weekly_challenge_participants")'));
  assert.ok(hook.includes('.select("challenge_id, completed_at")'));
  assert.ok(hook.includes('onConflict: "challenge_id,user_id", ignoreDuplicates: true'));
  assert.ok(hook.includes('supabase.rpc("complete_weekly_challenge"'));
  assert.ok(challengeScreen.includes('status === "started"'));
  assert.ok(challengeScreen.includes("window.localStorage.getItem(localStartedKey)"));
  assert.ok(challengeScreen.includes("window.localStorage.setItem(localStartedKey, \"true\")"));
  assert.ok(challengeScreen.includes("window.localStorage.removeItem(localStartedKey)"));
  assert.ok(challengeScreen.includes("userId && challenge ? startedKey(userId, challenge.id)"));
  assert.equal(challengeScreen.includes("start_weekly_challenge"), false);
  assert.equal(hook.includes("start_weekly_challenge"), false);
  assert.ok(types.includes('| "CHALLENGE"'));
  assert.ok(dashboard.includes('setActiveScreen("CHALLENGE")'));
  assert.ok(dashboard.includes("<WeeklyChallengeScreen"));
  assert.ok(home.includes('=== 1 ? "dad" : "dads"'));
  assert.ok(home.includes("onOpenChallenge"));
  assert.equal(home.includes("onGoProgress"), false);

  for (const expected of [
    "This week&apos;s challenge",
    "challenge.title",
    "challenge.description",
    "Ready for this week?",
    "One challenge. One week. A chance to show up where it matters.",
    "This week&apos;s mission",
    "I'm in",
    "You're in",
    "You made the commitment. Now make it count.",
    "Your challenge",
    "Start challenge",
    "Leave challenge",
    "Challenge on",
    "Go do it. Come back when you're done.",
    "I did it",
    "Challenge completed",
    "You showed up this week.",
  ]) {
    assert.ok(challengeScreen.includes(expected), `Dedicated web challenge screen is missing: ${expected}`);
  }

  assert.equal(challengeScreen.includes("participantCount"), false);
  assert.equal(challengeScreen.includes("dad taking part"), false);
});
