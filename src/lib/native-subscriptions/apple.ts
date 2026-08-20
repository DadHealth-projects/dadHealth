import {
  AutoRenewStatus,
  Environment,
  OfferDiscountType,
  OfferType,
  SignedDataVerifier,
  Status,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from "@apple/app-store-server-library";

import { DAD_HEALTH_BUNDLE_ID, SubscriptionConfigurationError, requireKnownAppleProduct } from "./config";
import { unixMillisecondsToIso, type SubscriptionEntitlementInput, type SubscriptionEnvironment } from "./types";

function rootCertificates(): Buffer[] {
  const raw = process.env.APPLE_IAP_ROOT_CERTIFICATES_BASE64?.trim();
  if (!raw) throw new SubscriptionConfigurationError("Apple purchase verification is not configured");
  let values: unknown;
  try {
    values = JSON.parse(raw);
  } catch {
    throw new SubscriptionConfigurationError("Apple purchase verification is not configured");
  }
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== "string")) {
    throw new SubscriptionConfigurationError("Apple purchase verification is not configured");
  }
  return values.map((value) => Buffer.from(value as string, "base64"));
}

function verifier(environment: Environment): SignedDataVerifier {
  const checks = process.env.APPLE_IAP_ENABLE_ONLINE_CHECKS !== "false";
  const appAppleId = Number(process.env.APPLE_IAP_APP_APPLE_ID);
  if (environment === Environment.PRODUCTION && (!Number.isInteger(appAppleId) || appAppleId <= 0)) {
    throw new SubscriptionConfigurationError("Apple purchase verification is not configured");
  }
  return new SignedDataVerifier(
    rootCertificates(),
    checks,
    environment,
    DAD_HEALTH_BUNDLE_ID,
    environment === Environment.PRODUCTION ? appAppleId : undefined,
  );
}

export interface VerifiedAppleTransaction {
  transaction: JWSTransactionDecodedPayload;
  environment: SubscriptionEnvironment;
}

export async function verifyAppleTransaction(signedTransaction: string): Promise<VerifiedAppleTransaction> {
  if (!signedTransaction || signedTransaction.length > 20_000) throw new Error("Invalid Apple transaction");
  let productionError: unknown;
  try {
    return {
      transaction: await verifier(Environment.PRODUCTION).verifyAndDecodeTransaction(signedTransaction),
      environment: "production",
    };
  } catch (error) {
    productionError = error;
  }
  try {
    return {
      transaction: await verifier(Environment.SANDBOX).verifyAndDecodeTransaction(signedTransaction),
      environment: "sandbox",
    };
  } catch {
    throw productionError instanceof Error ? productionError : new Error("Apple transaction verification failed");
  }
}

export async function verifyAppleNotification(signedPayload: string): Promise<{
  notification: ResponseBodyV2DecodedPayload;
  transaction: JWSTransactionDecodedPayload | null;
  renewal: JWSRenewalInfoDecodedPayload | null;
  environment: SubscriptionEnvironment;
}> {
  if (!signedPayload || signedPayload.length > 100_000) throw new Error("Invalid Apple notification");
  let result: { notification: ResponseBodyV2DecodedPayload; environment: SubscriptionEnvironment } | null = null;
  let productionError: unknown;
  try {
    result = {
      notification: await verifier(Environment.PRODUCTION).verifyAndDecodeNotification(signedPayload),
      environment: "production",
    };
  } catch (error) {
    productionError = error;
  }
  if (!result) {
    try {
      result = {
        notification: await verifier(Environment.SANDBOX).verifyAndDecodeNotification(signedPayload),
        environment: "sandbox",
      };
    } catch {
      throw productionError instanceof Error ? productionError : new Error("Apple notification verification failed");
    }
  }

  const signedTransaction = result.notification.data?.signedTransactionInfo;
  const signedRenewal = result.notification.data?.signedRenewalInfo;
  const selectedVerifier = verifier(
    result.environment === "production" ? Environment.PRODUCTION : Environment.SANDBOX,
  );
  const [transaction, renewal] = await Promise.all([
    signedTransaction ? selectedVerifier.verifyAndDecodeTransaction(signedTransaction) : Promise.resolve(null),
    signedRenewal ? selectedVerifier.verifyAndDecodeRenewalInfo(signedRenewal) : Promise.resolve(null),
  ]);
  return { ...result, transaction, renewal };
}

function appleStatus(
  transaction: JWSTransactionDecodedPayload,
  renewal?: JWSRenewalInfoDecodedPayload | null,
  notificationStatus?: Status | number,
): string {
  if (transaction.revocationDate || notificationStatus === Status.REVOKED) return "revoked";
  if (notificationStatus === Status.BILLING_GRACE_PERIOD) return "grace_period";
  if (notificationStatus === Status.BILLING_RETRY) return "past_due";
  if (notificationStatus === Status.EXPIRED) return "expired";
  const now = Date.now();
  if (transaction.expiresDate && transaction.expiresDate <= now) {
    if (renewal?.gracePeriodExpiresDate && renewal.gracePeriodExpiresDate > now) return "grace_period";
    if (renewal?.isInBillingRetryPeriod) return "past_due";
    return "expired";
  }
  const freeTrial = transaction.offerType === OfferType.INTRODUCTORY_OFFER
    && (transaction.offerDiscountType === OfferDiscountType.FREE_TRIAL || transaction.price === 0);
  return freeTrial ? "trialing" : "active";
}

export function appleEntitlementInput(
  userId: string,
  verified: VerifiedAppleTransaction,
  renewal?: JWSRenewalInfoDecodedPayload | null,
  notificationStatus?: Status | number,
): SubscriptionEntitlementInput {
  const transaction = verified.transaction;
  if (transaction.bundleId !== DAD_HEALTH_BUNDLE_ID) throw new Error("Apple transaction is for another app");
  if (!transaction.originalTransactionId || !transaction.transactionId || !transaction.productId) {
    throw new Error("Apple transaction is incomplete");
  }
  const plan = requireKnownAppleProduct(transaction.productId);
  const trialing = transaction.offerType === OfferType.INTRODUCTORY_OFFER
    && (transaction.offerDiscountType === OfferDiscountType.FREE_TRIAL || transaction.price === 0);

  return {
    userId,
    provider: "apple",
    providerSubscriptionId: transaction.originalTransactionId,
    providerAccountId: transaction.appAccountToken ?? null,
    latestTransactionId: transaction.transactionId,
    productId: transaction.productId,
    plan,
    status: appleStatus(transaction, renewal, notificationStatus),
    currentPeriodEnd: unixMillisecondsToIso(transaction.expiresDate),
    trialEnd: trialing ? unixMillisecondsToIso(transaction.expiresDate) : null,
    autoRenews: renewal ? renewal.autoRenewStatus === AutoRenewStatus.ON : null,
    environment: verified.environment,
    lastVerifiedAt: new Date().toISOString(),
  };
}
