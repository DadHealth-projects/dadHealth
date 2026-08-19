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

test("Present Dad completion is enforced against the server-owned ends_at", async () => {
  const schema = await source("supabase/schema.sql");
  const dispatch = await source("src/app/api/notifications/dispatch/route.ts");

  assert.match(schema, /new\.ends_at := new\.started_at \+ interval '60 minutes'/);
  assert.match(schema, /statement_timestamp\(\) < old\.ends_at/);
  assert.match(dispatch, /\.eq\("status", "active"\)[\s\S]*\.lte\("ends_at", nowIso\)/);
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
