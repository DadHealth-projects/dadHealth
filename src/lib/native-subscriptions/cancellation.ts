import { Status } from '@apple/app-store-server-library';
import type { verifyAppleNotification } from './apple';
import type { NativeSubscriptionAuth } from './auth';
import { entitlementGrantsAccess, type CancellationEvidence, type SubscriptionEntitlementRow } from './types';

export const CANCELLATION_REASONS = ['too_expensive', 'not_using', 'missing_feature', 'technical_problem', 'other'] as const;
export type CancellationReason = typeof CANCELLATION_REASONS[number];
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function parseFeedback(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (!isUuid(item.id) || !isUuid(item.subscriptionId) || !CANCELLATION_REASONS.includes(item.reason as CancellationReason)
    || typeof item.details !== 'string' || item.details.length > 1000) return null;
  return { id: item.id, subscriptionId: item.subscriptionId, reason: item.reason as CancellationReason, details: item.details.trim() };
}
export async function ownedSubscription(auth: NativeSubscriptionAuth, id: string): Promise<SubscriptionEntitlementRow | null> {
  const { data, error } = await auth.admin.from('subscription_entitlements').select('*').eq('id', id).eq('user_id', auth.user.id).maybeSingle();
  if (error) throw error;
  return data as SubscriptionEntitlementRow | null;
}
export function canCancel(item: SubscriptionEntitlementRow) {
  return item.provider === 'apple' && entitlementGrantsAccess(item);
}
export async function membershipDetails(auth: NativeSubscriptionAuth) {
  // One SQL statement joins both records under one MVCC snapshot.
  const { data, error } = await auth.admin.rpc('read_apple_membership_snapshot', { p_user_id: auth.user.id });
  if (error) throw error;
  const rows = data as Array<{ subscription: SubscriptionEntitlementRow; evidence: {
    source: string; snapshot_verified_at: string; scheduled_end_at: string | null;
  } | null }> | null;
  return (rows ?? []).filter(row => row.subscription.provider === 'apple').map(({ subscription: item, evidence }) => {
    // Evidence is ordered by provider event time, independently of restore time.
    const scheduled = canCancel(item) && evidence?.source === 'apple_renewal_disabled'
      && Date.parse(evidence.scheduled_end_at ?? '') > Date.now();
    return { id: item.id, provider: item.provider, plan: item.plan, status: item.status,
      currentPeriodEnd: item.current_period_end, canCancel: canCancel(item),
      cancellation: scheduled ? { state: 'scheduled' as const, end: evidence?.scheduled_end_at ?? null } : { state: 'unknown' as const, end: null } };
  });
}

// Called only with cryptographically verified notification/transaction/renewal data.
export function appleCancellationEvidence(verified: Awaited<ReturnType<typeof verifyAppleNotification>>): CancellationEvidence | null {
  const { notification, transaction, renewal } = verified;
  if (transaction && (transaction.revocationDate || notification.data?.status === Status.REVOKED
    || notification.data?.status === Status.EXPIRED)) {
    return { source: 'apple_terminal', scheduledEndAt: null };
  }
  if (notification.notificationType !== 'DID_CHANGE_RENEWAL_STATUS'
    || !transaction || !renewal || transaction.revocationDate
    || !renewal.originalTransactionId || renewal.originalTransactionId !== transaction.originalTransactionId
    || renewal.productId !== transaction.productId || renewal.environment !== transaction.environment) return null;
  if (notification.subtype === 'AUTO_RENEW_ENABLED' && renewal.autoRenewStatus === 1) {
    return { source: 'apple_renewal_enabled', scheduledEndAt: null };
  }
  if (notification.subtype !== 'AUTO_RENEW_DISABLED' || renewal.autoRenewStatus !== 0) return null;
  const end = transaction.expiresDate;
  return { source: 'apple_renewal_disabled', scheduledEndAt: typeof end === 'number' && Number.isFinite(end) ? new Date(end).toISOString() : null };
}
