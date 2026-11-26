import { randomUUID } from 'node:crypto';
import { OfferType, PromotionalOfferSignatureCreator } from '@apple/app-store-server-library';
import { canCancel } from './cancellation';
import type { SubscriptionEntitlementRow } from './types';

/**
 * Brief 01: the 50%-for-3-months last-resort offer, Apple side only.
 *
 * Off until the client configures the store offer and an In-App Purchase key:
 *   APPLE_IAP_RETENTION_OFFER_ID      offer identifier from App Store Connect (e.g. retention_50_3m)
 *   APPLE_IAP_RETENTION_PRODUCT_IDS   comma-separated product ids the offer exists on (e.g. the monthly product)
 *   APPLE_IAP_OFFER_KEY_ID            In-App Purchase key id
 *   APPLE_IAP_OFFER_PRIVATE_KEY_BASE  base64 of the .p8 file (PEM)
 *   APPLE_IAP_BUNDLE_ID               defaults to co.uk.dadhealth
 * Eligibility beyond "an Apple subscription the member can cancel, on a product the offer exists on"
 * (once per account, trial members, annual plans) is a client decision and is not assumed here.
 */
export interface RetentionOfferConfig {
  offerId: string;
  productIds: string[];
  keyId: string;
  privateKey: string;
  bundleId: string;
}

export interface SignedRetentionOffer {
  productId: string;
  /** Shape of react-native-iap `DiscountOfferInputIOS`. */
  offer: { identifier: string; keyIdentifier: string; nonce: string; signature: string; timestamp: number };
}

export function retentionOfferConfig(env: Record<string, string | undefined> = process.env): RetentionOfferConfig | null {
  const offerId = env.APPLE_IAP_RETENTION_OFFER_ID?.trim();
  const productIds = (env.APPLE_IAP_RETENTION_PRODUCT_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean);
  const keyId = env.APPLE_IAP_OFFER_KEY_ID?.trim();
  const encoded = env.APPLE_IAP_OFFER_PRIVATE_KEY_BASE?.trim();
  if (!offerId || !productIds.length || !keyId || !encoded) return null;
  const privateKey = Buffer.from(encoded, 'base64').toString('utf8');
  if (!privateKey.includes('PRIVATE KEY')) return null;
  return { offerId, productIds, keyId, privateKey, bundleId: env.APPLE_IAP_BUNDLE_ID?.trim() || 'co.uk.dadhealth' };
}

export function retentionOfferEligible(item: SubscriptionEntitlementRow, config: RetentionOfferConfig) {
  return canCancel(item) && typeof item.product_id === 'string' && config.productIds.includes(item.product_id);
}

/**
 * Signs a fresh offer for the member's own Apple subscription. The app account token is the
 * member's user id, the same value bound to their purchases, so a signature cannot be replayed
 * by another account. Apple accepts a signature for 24 hours; every call uses a new nonce.
 */
export function signRetentionOffer(item: SubscriptionEntitlementRow, userId: string, config: RetentionOfferConfig,
  now = Date.now(), nonce: string = randomUUID()): SignedRetentionOffer | null {
  if (item.user_id !== userId || !retentionOfferEligible(item, config)) return null;
  const creator = new PromotionalOfferSignatureCreator(config.privateKey, config.keyId, config.bundleId);
  const signature = creator.createSignature(item.product_id!, config.offerId, userId.toLowerCase(), nonce.toLowerCase(), now);
  return { productId: item.product_id!, offer: { identifier: config.offerId, keyIdentifier: config.keyId, nonce: nonce.toLowerCase(), signature, timestamp: now } };
}

type RedemptionTransaction = {
  offerType?: number; offerIdentifier?: string; originalTransactionId?: string; transactionId?: string;
  productId?: string; purchaseDate?: number;
};
type RpcClient = { rpc: (name: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/**
 * Durable record (client audit A3) of an Apple-verified transaction that used our retention offer.
 * Call only after Apple's signature was verified and the owner's subscription row was saved.
 * Returns false (and writes nothing) when the transaction did not use the configured offer.
 * Idempotent on Apple's transaction id; throws when the record could not be saved.
 */
export async function recordRetentionOfferRedemption(admin: RpcClient, userId: string,
  verified: { transaction: RedemptionTransaction | null | undefined; environment: string },
  source: 'verified_purchase' | 'store_notification', config: RetentionOfferConfig | null = retentionOfferConfig()): Promise<boolean> {
  const t = verified.transaction;
  if (!t || !retentionOfferApplied(t, config)) return false;
  if (!t.originalTransactionId || !t.transactionId || !t.productId) throw new Error('retention_offer_transaction_incomplete');
  const { error } = await admin.rpc('record_retention_offer_redemption', {
    p_user_id: userId, p_provider: 'apple', p_environment: verified.environment,
    p_original_transaction_id: t.originalTransactionId, p_transaction_id: t.transactionId,
    p_offer_identifier: t.offerIdentifier, p_product_id: t.productId,
    p_purchased_at: typeof t.purchaseDate === 'number' && Number.isFinite(t.purchaseDate) ? new Date(t.purchaseDate).toISOString() : null,
    p_source: source,
  });
  if (error) throw new Error('retention_offer_record_failed');
  return true;
}

/**
 * Authoritative acceptance check: Apple's verified transaction carries the promotional offer type and
 * our configured offer identifier. A purchase without the offer (or with another offer) is never "accepted".
 */
export function retentionOfferApplied(transaction: { offerType?: number; offerIdentifier?: string } | null | undefined,
  config: RetentionOfferConfig | null = retentionOfferConfig()) {
  return Boolean(config && transaction && transaction.offerType === OfferType.PROMOTIONAL_OFFER
    && transaction.offerIdentifier === config.offerId);
}
