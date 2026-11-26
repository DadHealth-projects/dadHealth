import { createHash } from 'node:crypto';
import type { SubscriptionEntitlementInput, SubscriptionEntitlementRow } from '../native-subscriptions/types';
import { permittedProperties } from './contract';
import type { createAdminSupabaseClient } from '@/utils/supabase/admin';

export type BillingConsent = { owner: string; consent: string; secretHash: string; validFrom: string; validUntil: string };
export type PaidEvidence = { transactionId: string; paidAt: string; amount: number; verified: true; servicePeriodStart?: string };
export type BillingFact = { event: string; key: string; timestamp: string; properties: Record<string,string> };
/** Inputs must originate in the existing verified provider adapters, never a request body. */
export function billingFacts(input: SubscriptionEntitlementInput, previous: SubscriptionEntitlementRow | null, paid?: PaidEvidence): BillingFact[] {
  const at = input.lastVerifiedAt;
  if (!at || !Number.isFinite(Date.parse(at))) return [];
  if (previous && (previous.user_id !== input.userId || previous.provider !== input.provider
    || previous.environment !== input.environment || previous.provider_subscription_id !== input.providerSubscriptionId
    || (previous.last_verified_at && Date.parse(at) <= Date.parse(previous.last_verified_at)))) return [];
  const facts: BillingFact[] = [];
  const props = { provider: input.provider, environment: input.environment };
  const add = (event: string, identity: string, timestamp = at, cancelled = false) => {
    const properties = cancelled ? {...props,reason:'unavailable'} : props;
    if (!permittedProperties(event,properties,'server')) return;
    facts.push({event,properties,timestamp,key:'billing:'+createHash('sha256').update(
      [input.provider,input.environment,input.providerSubscriptionId,event,identity].join(':')).digest('hex')});
  };
  if (input.status === 'trialing' && input.trialFacts && Date.parse(input.trialFacts.startedAt)<Date.parse(input.trialFacts.endsAt))
    add('trial_started', input.trialFacts.transactionId, input.trialFacts.startedAt);
  // Active/manual access is not payment evidence. A prior verified trial and a
  // positive, verified transaction after its start are both required.
  const trialEnd = previous?.trial_end ?? input.trialEnd;
  const transitionProven = previous?.status === 'trialing' || (paid?.servicePeriodStart && trialEnd && Date.parse(paid.servicePeriodStart) === Date.parse(trialEnd));
  if (trialEnd && transitionProven && input.status === 'active' && paid?.verified
    && Number.isFinite(paid.amount) && paid.amount > 0 && paid.transactionId === input.latestTransactionId
    && Date.parse(paid.paidAt)>=Date.parse(trialEnd) && Date.parse(paid.paidAt)<=Date.parse(at))
    add('trial_converted',trialEnd,paid.paidAt);
  if (previous?.auto_renews === true && input.autoRenews === false
    && ['trialing','active','grace_period'].includes(input.status))
    add(input.status === 'trialing' ? 'trial_cancelled' : 'subscription_cancelled',`${previous.last_verified_at}:${previous.current_period_end}`,at,true);
  return facts;
}
/** Only the separate server-persisted account choice authorizes background facts.
 * The legacy argument is ignored: a device capability can never authorize billing.
 * Collection remains default-off until the consent flow passes acceptance. */
export async function collectVerifiedBilling(admin: ReturnType<typeof createAdminSupabaseClient>, input: SubscriptionEntitlementInput,
 previous: SubscriptionEntitlementRow | null, _consent: BillingConsent | null, paid?: PaidEvidence) {
  if (process.env.ANALYTICS_BILLING_COLLECTION_ENABLED !== 'true' || process.env.ANALYTICS_INGEST_ENABLED !== 'true'
    || process.env.ANALYTICS_PRIVACY_ENABLED !== 'true') return { suppressed:true, collected:0 };
  let collected=0;
  try {
    for (const fact of billingFacts(input,previous,paid)) {
      const result=await admin.rpc('record_account_billing_analytics',{
        p_owner:input.userId,
        p_provider:input.provider,p_environment:input.environment,p_subscription:input.providerSubscriptionId,
        p_verified_at:input.lastVerifiedAt,p_event:fact.event,p_key:fact.key,p_at:fact.timestamp,p_properties:fact.properties,
        p_observed_after: fact.event.endsWith('_cancelled') ? previous?.last_verified_at ?? null : fact.timestamp,
      }).abortSignal(AbortSignal.timeout(3000));
      if(result.error) throw result.error;
      if(result.data===true) collected++;
    }
  } catch { console.warn('[analytics]',{stage:'billing',code:'collection_unavailable'}); }
  return {suppressed:false,collected};
}

/** All three gates must be on before any billing fact is journalled or collected (default off). */
export function billingCollectionEnabled(env: Record<string, string | undefined> = process.env) {
  return env.ANALYTICS_BILLING_COLLECTION_ENABLED === 'true' && env.ANALYTICS_INGEST_ENABLED === 'true'
    && env.ANALYTICS_PRIVACY_ENABLED === 'true';
}

/** Client audit A6: verified adapter facts stored with the snapshot, in the same transaction. */
export function journalObservation(input: SubscriptionEntitlementInput) {
  return {
    status: input.status, autoRenews: input.autoRenews ?? null, latestTransactionId: input.latestTransactionId ?? null,
    trialEnd: input.trialEnd ?? null, trialFacts: input.trialFacts ?? null, verifiedPayment: input.verifiedPayment ?? null,
    ...(input.retentionOffer ? { retentionOffer: input.retentionOffer } : {}),
  };
}

export type BillingJournalRow = {
  id: string; user_id: string; provider: string; environment: string; provider_subscription_id: string;
  verified_at: string; previous: Partial<SubscriptionEntitlementRow> | null;
  observed: ReturnType<typeof journalObservation> & { trialPeriodEndsAt?: string | null };
};

/** The same billingFacts rules, applied to the stored transition (never to later state). */
export function journalFacts(row: BillingJournalRow): BillingFact[] {
  const o = row.observed ?? ({} as BillingJournalRow['observed']);
  const input = {
    userId: row.user_id, provider: row.provider, environment: row.environment,
    providerSubscriptionId: row.provider_subscription_id, status: o.status, autoRenews: o.autoRenews ?? undefined,
    latestTransactionId: o.latestTransactionId ?? undefined, trialEnd: o.trialEnd ?? o.trialPeriodEndsAt ?? null,
    trialFacts: o.trialFacts ?? undefined, lastVerifiedAt: new Date(row.verified_at).toISOString(),
  } as SubscriptionEntitlementInput;
  const facts = billingFacts(input, (row.previous as SubscriptionEntitlementRow | null) ?? null, o.verifiedPayment ?? undefined);
  // Brief 06 "50% offer accepted": one fact per verified offer transaction, at its purchase time.
  const offer = o.retentionOffer;
  const properties = { provider: row.provider, environment: row.environment };
  if (offer && typeof offer.transactionId === 'string' && offer.transactionId && Number.isFinite(Date.parse(offer.purchasedAt))
    && permittedProperties('retention_offer_accepted', properties, 'server')) {
    facts.push({ event: 'retention_offer_accepted', properties, timestamp: new Date(offer.purchasedAt).toISOString(),
      key: 'billing:' + createHash('sha256').update([row.provider, row.environment, row.provider_subscription_id,
        'retention_offer_accepted', offer.transactionId].join(':')).digest('hex') });
  }
  return facts;
}

/**
 * Records journalled transitions through the consent-checked account path. A row is removed
 * only after every fact was recorded or suppressed; any failure leaves it for the next drain.
 * Never throws: billing must not fail because analytics is unavailable.
 */
export async function drainBillingTransitions(admin: ReturnType<typeof createAdminSupabaseClient>, owner: string | null, limit = 20) {
  const result = { suppressed: false, processed: 0, collected: 0, failed: 0 };
  if (!billingCollectionEnabled()) return { ...result, suppressed: true };
  let rows: BillingJournalRow[] = [];
  try {
    const pending = await admin.rpc('pending_billing_analytics_transitions', { p_owner: owner, p_limit: limit });
    if (pending.error) throw pending.error;
    rows = (Array.isArray(pending.data) ? pending.data : []) as BillingJournalRow[];
  } catch {
    console.warn('[analytics]', { stage: 'billing_journal', code: 'pending_unavailable' });
    return { ...result, failed: 1 };
  }
  for (const row of rows) {
    try {
      for (const fact of journalFacts(row)) {
        const recorded = await admin.rpc('record_account_billing_analytics', {
          p_owner: row.user_id, p_provider: row.provider, p_environment: row.environment, p_subscription: row.provider_subscription_id,
          p_verified_at: new Date(row.verified_at).toISOString(), p_event: fact.event, p_key: fact.key, p_at: fact.timestamp,
          p_properties: fact.properties,
          p_observed_after: fact.event.endsWith('_cancelled') ? row.previous?.last_verified_at ?? null : fact.timestamp,
        }).abortSignal(AbortSignal.timeout(3000));
        if (recorded.error) throw recorded.error;
        if (recorded.data === true) result.collected++;
      }
      const done = await admin.rpc('complete_billing_analytics_transition', { p_id: row.id });
      if (done.error) throw done.error;
      result.processed++;
    } catch {
      result.failed++;
      console.warn('[analytics]', { stage: 'billing_journal', code: 'drain_retry' });
    }
  }
  return result;
}
