import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("OneSignal uses the current API with platform-correct routing", async () => {
  const sender = await source("src/lib/notifications/onesignal.ts");

  for (const expected of [
    "https://api.onesignal.com/notifications",
    "Authorization: `Key ${apiKey}`",
    'target_channel: "push"',
    "include_aliases: { external_id: [args.externalUserId] }",
    "web_url:",
    "idempotency_key:",
    "data:",
  ]) {
    assert.ok(sender.includes(expected), `Missing current OneSignal field: ${expected}`);
  }

  for (const legacy of ["api/v1/notifications", "include_external_user_ids", "Basic ${apiKey}"]) {
    assert.equal(sender.includes(legacy), false, `Legacy OneSignal field remains: ${legacy}`);
  }
});

test("notification delivery is finalized only after OneSignal succeeds", async () => {
  const delivery = await source("src/lib/notifications/delivery.ts");
  const sendIndex = delivery.indexOf("await sendOneSignalToExternalUserId");
  const completeIndex = delivery.indexOf('rpc("complete_notification_delivery"');

  assert.ok(sendIndex >= 0);
  assert.ok(completeIndex > sendIndex);
});

test("notification claims are concurrency-safe and service-role-only", async () => {
  const schema = await source("supabase/schema.sql");

  assert.match(schema, /pg_advisory_xact_lock/);
  assert.match(schema, /revoke all on function public\.claim_notification_delivery[\s\S]*from public, anon, authenticated/);
  assert.match(schema, /grant execute on function public\.claim_notification_delivery[\s\S]*to service_role/);
  assert.match(schema, /drop function if exists public\.log_notification_if_allowed/);
});

test("event-driven notifications use per-record claim identities", async () => {
  const [schema, migration, delivery, events, dispatch, regression] = await Promise.all([
    source("supabase/schema.sql"),
    source("supabase/migrations/20260819150000_notification_event_keys.sql"),
    source("src/lib/notifications/delivery.ts"),
    source("src/app/api/notifications/events/route.ts"),
    source("src/app/api/notifications/dispatch/route.ts"),
    source("supabase/tests/notification_claims_test.sql"),
  ]);

  for (const sql of [schema, migration]) {
    assert.match(sql, /event_key/);
    assert.match(sql, /notification_delivery_claims\(user_id, type, local_day, event_key\)/);
    assert.match(sql, /pg_advisory_xact_lock/);
    assert.match(sql, /reserved_today \+ legacy_sent_today >= 3/);
    assert.match(sql, /event_key = claim_event_key/);
    assert.match(sql, /return existing_claim\.id/);
    assert.match(sql, /p_timezone,\s*'scheduled'/);
    assert.match(sql, /claim_notification_delivery\(uuid, text, text, text\)/);
  }
  assert.match(schema, /event_key text not null default 'scheduled'/);

  assert.match(delivery, /p_event_key: args\.eventKey\?\.trim\(\) \|\| "scheduled"/);
  assert.match(delivery, /idempotencyKey: claimId/);
  assert.match(events, /type: "community_reply",\s*eventKey: comment\.id/);
  assert.match(events, /type: "co_parent_event_added",\s*eventKey: event\.id/);
  assert.match(dispatch, /type: "present_dad_mode_complete",[\s\S]*eventKey: session\.id/);

  for (const scenario of [
    "comment A receives a delivery claim",
    "comment B on the same day receives a delivery claim",
    "a completed retry of comment A is skipped as a duplicate",
    "a fourth eligible notification is skipped by the daily cap",
    "the scheduled wrapper does not duplicate its notification period",
    "an incomplete retry receives the original claim ID",
  ]) {
    assert.ok(regression.includes(scenario), `Missing SQL regression scenario: ${scenario}`);
  }
});

test("temporary notification skip diagnostics are removed", async () => {
  const events = await source("src/app/api/notifications/events/route.ts");

  assert.equal(events.includes("EventSkipReason"), false);
  assert.equal(events.includes("[notifications/events] Delivery skipped"), false);
  assert.equal(events.includes("rate_limit_unknown"), false);
});

test("Present Dad completion is enforced against the server-owned ends_at", async () => {
  const schema = await source("supabase/schema.sql");
  const dispatch = await source("src/app/api/notifications/dispatch/route.ts");

  assert.match(schema, /new\.ends_at := new\.started_at \+ interval '60 minutes'/);
  assert.match(schema, /statement_timestamp\(\) < old\.ends_at/);
  assert.match(dispatch, /\.eq\("status", "active"\)[\s\S]*\.lte\("ends_at", nowIso\)/);
});

test("Weekly Challenge notification is skipped when no active challenge exists", async () => {
  const dispatch = await source("src/app/api/notifications/dispatch/route.ts");

  assert.match(
    dispatch,
    /if \(type === "weekly_challenge"\)[\s\S]*?weeklyChallenge = cachedChallenge \?\? null;[\s\S]*?if \(!weeklyChallenge\) \{[\s\S]*?skipped \+= 1;[\s\S]*?continue;/,
  );
});

test("the weekly Dad Health report is dispatched on Sunday", async () => {
  const [dispatch, time, settings] = await Promise.all([
    source("src/app/api/notifications/dispatch/route.ts"),
    source("src/lib/notifications/time.ts"),
    source("src/app/settings/page.tsx"),
  ]);

  // getLocalParts maps Sunday to 0.
  assert.match(time, /Sun: 0, Mon: 1/);

  const weekly = /type === "weekly_score"\) \{([\s\S]*?)\} else if/.exec(dispatch)?.[1] ?? "";
  assert.ok(weekly.length > 0);
  assert.match(weekly, /localDow === 0/);

  // The weekly challenge keeps its own Monday cadence.
  assert.match(dispatch, /type === "weekly_challenge"\) \{\s*due = localDow === 1/);

  // The window still ends on yesterday, so it stays a complete seven days.
  assert.match(dispatch, /computeWeeklyScore\(admin, userId, ymdAddDays\(localDate, -1\)\)/);

  // Settings copy agrees with the dispatcher.
  assert.match(settings, /Sunday 08:00 - Your Dad Health Score this week/);
});

test("the meal planner allows three free AI plans before requiring Pro", async () => {
  const route = await source("src/app/api/generate-meal-plan/route.ts");

  assert.match(route, /export const FREE_AI_MEAL_PLANS = 3/);
  // The allowance is only checked for members without Pro.
  assert.match(route, /if \(!isProfilePro\([\s\S]*?\.eq\('source', 'ai_generated'\)/);
  assert.match(route, /count \?\? 0\) >= FREE_AI_MEAL_PLANS/);
  assert.match(route, /code: 'meal_plan_limit_reached'/);
  // The old unconditional Pro wall is gone.
  assert.doesNotMatch(route, /Meal planner is a Pro feature/);
});

test("notification environment and database setting names stay aligned", async () => {
  const envExample = await source(".env.local.example");
  const schema = await source("supabase/schema.sql");

  for (const variable of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SITE_URL",
    "NEXT_PUBLIC_ONESIGNAL_APP_ID",
    "ONESIGNAL_APP_ID",
    "ONESIGNAL_REST_API_KEY",
    "CRON_SECRET",
    "NOTIFICATION_WEBHOOK_SECRET",
  ]) {
    assert.match(envExample, new RegExp(`^${variable}=`, "m"), `Missing environment name: ${variable}`);
  }

  for (const setting of [
    "app.settings.notification_dispatch_url",
    "app.settings.cron_secret",
    "app.settings.notification_webhook_url",
    "app.settings.notification_webhook_secret",
  ]) {
    assert.ok(schema.includes(setting), `Missing database setting: ${setting}`);
  }
});

test("event delivery has database, server, and provider diagnostics", async () => {
  const [schema, events, dispatch, delivery, oneSignal] = await Promise.all([
    source("supabase/schema.sql"),
    source("src/app/api/notifications/events/route.ts"),
    source("src/app/api/notifications/dispatch/route.ts"),
    source("src/lib/notifications/delivery.ts"),
    source("src/lib/notifications/onesignal.ts"),
  ]);

  assert.match(schema, /Queued notification event type/);
  assert.match(schema, /Queued notification dispatch pg_net request/);
  assert.match(events, /\[notifications\/events\] Event received/);
  assert.match(dispatch, /\[notifications\/dispatch\] Run started/);
  assert.match(delivery, /\[notifications\/delivery\] Sending claimed notification/);
  assert.match(oneSignal, /\[notifications\/onesignal\] Message accepted/);
});
