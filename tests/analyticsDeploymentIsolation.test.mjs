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

test('deployable runtime has no unfinished remote-export import or RPC dependency', () => {
  for (const path of files('src').filter(path => /\.[cm]?[jt]sx?$/.test(path))) {
    assert.doesNotMatch(read(path), /captureRemoteAnalytics|begin_account_export_analytics|save_account_export_analytics|restart_account_export_analytics|finish_account_export_analytics|export-analytics/, path);
  }
  const active = read('src/lib/privacy/export.ts');
  assert.ok(active.indexOf("rpc('capture_account_export'") < active.indexOf("rpc('read_account_export_chunk'"));
  assert.match(active, /authorize_account_export_send/);
  assert.match(active, /delivery_reconciliation_required/);
});

test('unfinished proposal is preserved outside automatic migration and test discovery', () => {
  assert.equal(existsSync('supabase/migrations/20261121120000_account_export_remote_analytics.sql'), false);
  assert.equal(existsSync('src/lib/privacy/export-analytics.ts'), false);
  for (const name of ['export-analytics.ts.txt', '20261121120000_account_export_remote_analytics.sql.disabled',
    'analyticsRemoteExport.test.mjs.txt', 'analyticsRemoteExportDatabase.test.mjs.txt', 'integration.patch']) {
    assert.ok(read(`${proposal}/${name}`).length > 0, name);
  }
  assert.match(read(`${proposal}/integration.patch`), /captureRemoteAnalytics/);
  assert.ok(files(proposal).every(path => !/\.(?:tsx?|mjs|sql)$/.test(path)));
});
