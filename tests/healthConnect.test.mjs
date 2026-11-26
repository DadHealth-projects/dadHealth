import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('Health Connect schema supports native connections without provider tokens', async () => {
  const schema = await source('supabase/schema.sql');
  assert.match(schema, /check \(source in \('manual', 'garmin', 'fitbit', 'apple_health', 'health_connect'\)\)/);
  assert.match(schema, /check \(provider in \('garmin', 'fitbit', 'apple_health', 'health_connect'\)\)/);
  assert.match(schema, /provider in \('apple_health', 'health_connect'\) and access_token is null and refresh_token is null/);
  assert.match(schema, /access_token text,/);
});

test('Current forward health RPC preserves authentication, manual totals and connection serialization', async () => {
  const migration = await source('supabase/migrations/20261126121000_health_sync_boundaries.sql');
  assert.match(migration, /auth\.uid\(\) is null/);
  assert.match(migration, /user_id=auth\.uid\(\) and provider=p_provider/);
  assert.match(migration, /for update/);
  assert.match(migration, /b\.source='manual'/);
  assert.match(migration, /where body_metrics\.source<>'manual'/);
  assert.match(migration, /where sleep_logs\.source<>'manual'/);
  assert.match(migration, /from public,anon/);
  assert.match(migration, /to authenticated/);
  assert.doesNotMatch(migration, /notification_delivery|notification_log|cron\.schedule|invoke_wearable_sync/);
});

test('Health Connect remains outside the Garmin and Fitbit server cron', async () => {
  const wearableSync = await source('supabase/functions/wearable-sync/index.ts');

  assert.match(wearableSync, /\.in\("provider", \["garmin", "fitbit"\]\)/);
  assert.doesNotMatch(wearableSync, /health_connect/);
});
