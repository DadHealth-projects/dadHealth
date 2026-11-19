import { processExport } from './export';
import { processDeletion } from './deletion';
import { checkpoint, type Operation, type PrivacyAdmin } from './operations';
import { PrivacyError } from './auth';

export async function runPrivacyWorker(admin: PrivacyAdmin) {
  const cleanup = await admin.rpc('cleanup_account_privacy_retention');
  if (cleanup.error) throw new PrivacyError('retention_cleanup_failed');
  const claimed = await admin.rpc('claim_account_privacy_operations', { p_limit: 2 });
  if (claimed.error || !Array.isArray(claimed.data)) throw new PrivacyError('claim_failed');
  const result = { processed: 0, deferred: 0 };
  for (const o of claimed.data as Operation[]) {
    try {
      if (o.kind === 'export') await processExport(admin, o); else await processDeletion(admin, o);
      result.processed++;
    } catch (error) {
      const reason = error instanceof PrivacyError ? error.code : 'processing_failed';
      // Bounded recovery, with a visible failed state requiring operator action.
      // No private error bodies, identifiers, tokens or payloads enter logs.
      await checkpoint(admin, o, { state: o.attempts >= 8 ? 'failed' : o.account_removed_at ? 'cleanup_pending' : 'queued',
        failure_code: reason, lease_token: null, lease_until: null,
        ...(o.kind === 'export' && o.attempts >= 8 ? { completed_at: new Date().toISOString() } : {}),
        next_attempt_at: new Date(Date.now() + Math.min(3600, 30 * 2 ** o.attempts) * 1000).toISOString() });
      result.deferred++;
    }
  }
  return result;
}
