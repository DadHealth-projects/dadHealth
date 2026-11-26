import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const proposal = 'docs/proposals/remote-analytics-export';
const read = path => readFileSync(path, 'utf8');
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}

test('remote export is opt-in and durable selection cannot be downgraded by a rollout change', () => {
  const active = read('src/lib/privacy/export.ts');
  assert.match(active, /!o.handoff_at && \(o.checkpoint\?\.remoteAnalyticsExport === 1 \|\| process.env.ANALYTICS_REMOTE_EXPORT_ENABLED === 'true'\)/);
  assert.ok(active.indexOf("rpc('capture_account_export'") < active.indexOf("rpc('read_account_export_chunk'"));
  assert.match(active, /if \(!await captureRemoteAnalytics\(admin, o\)\) return/);
  assert.match(active, /authorize_account_export_send/);
  assert.match(active, /delivery_reconciliation_required/);
});

test('unfinished proposal is preserved outside automatic migration and test discovery', () => {
  assert.equal(existsSync('supabase/migrations/20261121120000_account_export_remote_analytics.sql'), false);
  assert.equal(existsSync('supabase/migrations/20261126131000_account_export_remote_analytics.sql'), true);
  for (const name of ['export-analytics.ts.txt', '20261121120000_account_export_remote_analytics.sql.disabled',
    'analyticsRemoteExport.test.mjs.txt', 'analyticsRemoteExportDatabase.test.mjs.txt', 'integration.patch']) {
    assert.ok(read(`${proposal}/${name}`).length > 0, name);
  }
  assert.match(read(`${proposal}/integration.patch`), /captureRemoteAnalytics/);
  assert.ok(files(proposal).every(path => !/\.(?:tsx?|mjs|sql)$/.test(path)));
});
