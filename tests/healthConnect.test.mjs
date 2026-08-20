import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('Health Connect migration is additive and matches the committed schema RPC', async () => {
  const [schema, migration] = await Promise.all([
    source('supabase/schema.sql'),
    source('supabase/migrations/20260820000000_health_connect.sql'),
  ]);

  for (const sql of [schema, migration]) {
    assert.match(sql, /check \(source in \('manual', 'garmin', 'fitbit', 'apple_health', 'health_connect'\)\)/);
    assert.match(sql, /check \(provider in \('garmin', 'fitbit', 'apple_health', 'health_connect'\)\)/);
    assert.match(sql, /provider in \('apple_health', 'health_connect'\) and access_token is null and refresh_token is null/);
  }

  assert.match(migration, /alter column access_token drop not null[\s\S]*alter column refresh_token drop not null/);
  assert.equal(extractHealthConnectRpc(schema), extractHealthConnectRpc(migration));
  assert.doesNotMatch(migration, /notification_delivery|notification_log|cron\.schedule|invoke_wearable_sync/);
});

test('Health Connect RPC is authenticated and preserves manual daily data', async () => {
  const migration = await source('supabase/migrations/20260820000000_health_connect.sql');

  assert.match(migration, /current_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /existing\.recorded_at::date = metric\.recorded_at::date/);
  assert.match(migration, /existing\.source = 'manual'/);
  assert.match(migration, /where body_metrics\.source <> 'manual'/);
  assert.match(migration, /where sleep_logs\.source <> 'manual'/);
  assert.match(migration, /revoke execute .* from public/);
  assert.match(migration, /grant execute .* to authenticated/);
});

test('Health Connect remains outside the Garmin and Fitbit server cron', async () => {
  const wearableSync = await source('supabase/functions/wearable-sync/index.ts');

  assert.match(wearableSync, /\.in\("provider", \["garmin", "fitbit"\]\)/);
  assert.doesNotMatch(wearableSync, /health_connect/);
});

test('web check-in treats Health Connect sleep as wearable data', async () => {
  const dashboard = await source('src/hooks/useDashboard.ts');

  assert.match(dashboard, /existingSleep\?\.source === "health_connect"/);
});

function extractHealthConnectRpc(sql) {
  const match = sql.match(
    /create or replace function public\.upsert_health_connect_daily_data\([\s\S]*?grant execute on function public\.upsert_health_connect_daily_data\(jsonb, jsonb\) to authenticated;/,
  );
  assert.ok(match, 'Health Connect RPC definition is missing');
  return match[0];
}
