import { PrivacyError } from './auth';
import { checkpoint, type Operation, type PrivacyAdmin } from './operations';
import { deleteOneSignalOwner, openCleanup, sealCleanup, revokeAppleToken, revokeWearableAuthorization } from './external-cleanup';

export async function processDeletion(admin: PrivacyAdmin, o: Operation) {
  const progress = { ...o.checkpoint };
  if (!progress.external) {
    const owner = await admin.auth.admin.getUserById(o.user_id);
    if (owner.error || !owner.data.user) throw new PrivacyError('cleanup_identity_unavailable');
    const integrations = await admin.from('user_integrations').select('provider,access_token,refresh_token').eq('user_id', o.user_id);
    if (integrations.error) throw new PrivacyError('integration_inventory_failed');
    // Preserve only required cleanup material, encrypted, BEFORE Auth cascades.
    const confirmed = typeof progress.appleRevocation === 'string' ? openCleanup(progress.appleRevocation) : {};
    progress.external = sealCleanup({ appleRequired: owner.data.user.identities?.some(i => i.provider === 'apple') === true,
      appleRefreshToken: confirmed.appleRefreshToken, appleWeb: confirmed.appleWeb === true,
      integrations: integrations.data });
    delete progress.appleRevocation;
    await checkpoint(admin, o, { checkpoint: progress });
  }
  if (!progress.storage) {
    // Bound a worker invocation; a later lease continues from remaining objects.
    for (let batch = 0; batch < 5; batch++) {
      const { data, error } = await admin.rpc('list_account_privacy_objects', { p_user_id: o.user_id });
      if (error || !Array.isArray(data)) throw new PrivacyError('storage_inventory_failed');
      if (!data.length) { progress.storage = true; break; }
      const buckets = new Map<string, string[]>();
      for (const item of data) buckets.set(item.bucket, [...(buckets.get(item.bucket) ?? []), item.path]);
      for (const [bucket, paths] of buckets) {
        const removal = await admin.storage.from(bucket).remove(paths);
        if (removal.error) throw new PrivacyError('storage_cleanup_failed');
      }
    }
    await checkpoint(admin, o, { checkpoint: progress });
    if (!progress.storage) return;
  }
  if (!o.account_removed_at) {
    const cleanup = await admin.rpc('cleanup_account_private_records', { p_id: o.id, p_lease: o.lease_token });
    if (cleanup.error || cleanup.data !== true) throw new PrivacyError('private_cleanup_failed');
    // A prior worker may have removed Auth but lost its checkpoint response.
    const actual = await admin.auth.admin.getUserById(o.user_id);
    if (actual.error && actual.error.status !== 404) throw new PrivacyError('cleanup_identity_unavailable');
    if (!actual.error && !actual.data.user) throw new PrivacyError('cleanup_identity_unavailable');
    if (actual.data.user) {
      const removed = await admin.auth.admin.deleteUser(o.user_id);
      if (removed.error && removed.error.status !== 404) throw new PrivacyError('auth_cleanup_failed');
    }
    o.account_removed_at = new Date().toISOString();
    await checkpoint(admin, o, { state: 'account_removed', account_removed_at: o.account_removed_at, checkpoint: progress });
  }
  if (!progress.onesignal) {
    await deleteOneSignalOwner(o.user_id);
    progress.onesignal = true;
    await checkpoint(admin, o, { checkpoint: progress });
  }
  const external = openCleanup(String(progress.external));
  if (external.appleRequired && !progress.apple) {
    if (typeof external.appleRefreshToken !== 'string') throw new PrivacyError('apple_revocation_evidence_required');
    await revokeAppleToken(external.appleRefreshToken, external.appleWeb === true);
    progress.apple = true;
    await checkpoint(admin, o, { checkpoint: progress });
  }
  if (Array.isArray(external.integrations)) {
    for (const integration of external.integrations) {
      if (!integration || typeof integration.provider !== 'string') throw new PrivacyError('integration_inventory_failed');
      const key = `revoked_${integration.provider}`;
      if (progress[key]) continue;
      await revokeWearableAuthorization(integration, async next => {
        const integrations = external.integrations as Record<string, unknown>[];
        external.integrations = integrations.map(item => item === integration ? next : item);
        progress.external = sealCleanup(external);
        await checkpoint(admin, o, { checkpoint: progress });
      });
      progress[key] = true;
      await checkpoint(admin, o, { checkpoint: progress });
    }
  }
  await checkpoint(admin, o, { state: 'completed', completed_at: new Date().toISOString(), checkpoint: {},
    destination: null, lease_token: null, lease_until: null, failure_code: null });
}
