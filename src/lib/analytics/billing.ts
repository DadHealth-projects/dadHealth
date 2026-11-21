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
/** No applicable background-billing consent is currently defined. Callers pass
 * null. This is an explicit activation boundary, not an account-wide inference. */
export async function collectVerifiedBilling(admin: ReturnType<typeof createAdminSupabaseClient>, input: SubscriptionEntitlementInput,
 previous: SubscriptionEntitlementRow | null, consent: BillingConsent | null, paid?: PaidEvidence) {
  if (!consent || consent.owner!==input.userId) return { suppressed:true, collected:0 };
  let collected=0;
  try {
    for (const fact of billingFacts(input,previous,paid)) {
      if (Date.parse(fact.timestamp)<Date.parse(consent.validFrom) || Date.parse(fact.timestamp)>Date.parse(consent.validUntil)
        || !Number.isFinite(Date.parse(consent.validFrom)) || !Number.isFinite(Date.parse(consent.validUntil))) continue;
      const result=await admin.rpc('record_verified_billing_analytics',{
        p_owner:input.userId,p_consent:consent.consent,p_hash:consent.secretHash,
        p_provider:input.provider,p_environment:input.environment,p_subscription:input.providerSubscriptionId,
        p_verified_at:input.lastVerifiedAt,p_event:fact.event,p_key:fact.key,p_at:fact.timestamp,p_properties:fact.properties,
      });
      if(result.error) throw result.error;
      if(result.data===true) collected++;
    }
  } catch { console.warn('[analytics]',{stage:'billing',code:'collection_unavailable'}); }
  return {suppressed:false,collected};
}
