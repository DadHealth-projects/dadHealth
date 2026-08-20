import { createHmac } from "node:crypto";
import { GoogleAuth, OAuth2Client } from "google-auth-library";

import {
  DAD_HEALTH_ANDROID_PACKAGE,
  SubscriptionConfigurationError,
  isKnownGoogleTrialOffer,
  requireKnownGooglePlan,
} from "./config";
import type { SubscriptionEntitlementInput } from "./types";

interface GoogleLineItem {
  productId?: string;
  expiryTime?: string;
  latestSuccessfulOrderId?: string;
  autoRenewingPlan?: { autoRenewEnabled?: boolean };
  offerDetails?: { basePlanId?: string; offerId?: string };
}

export interface GoogleSubscriptionPurchase {
  kind?: string;
  regionCode?: string;
  startTime?: string;
  subscriptionState?: string;
  latestOrderId?: string;
  linkedPurchaseToken?: string;
  acknowledgementState?: string;
  externalAccountIdentifiers?: {
    obfuscatedExternalAccountId?: string;
    obfuscatedExternalProfileId?: string;
  };
  lineItems?: GoogleLineItem[];
  testPurchase?: Record<string, never>;
}

function serviceAccountCredentials(): Record<string, unknown> {
  const encoded = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (!encoded) throw new SubscriptionConfigurationError("Google Play purchase verification is not configured");
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid service account");
    return parsed as Record<string, unknown>;
  } catch {
    throw new SubscriptionConfigurationError("Google Play purchase verification is not configured");
  }
}

function publisherClient(): GoogleAuth {
  return new GoogleAuth({
    credentials: serviceAccountCredentials(),
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
}

function accountPepper(): string {
  const pepper = process.env.SUBSCRIPTION_ACCOUNT_PEPPER?.trim();
  if (!pepper || pepper.length < 32) {
    throw new SubscriptionConfigurationError("Native subscription account linking is not configured");
  }
  return pepper;
}

export function googleAccountReference(userId: string): string {
  return createHmac("sha256", accountPepper()).update(userId, "utf8").digest("hex");
}

function purchaseUrl(purchaseToken: string): string {
  return `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
    DAD_HEALTH_ANDROID_PACKAGE,
  )}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
}

export async function verifyGooglePurchase(purchaseToken: string): Promise<GoogleSubscriptionPurchase> {
  if (!purchaseToken || purchaseToken.length > 4_096) throw new Error("Invalid Google Play purchase token");
  const client = await publisherClient().getClient();
  const response = await client.request<GoogleSubscriptionPurchase>({ url: purchaseUrl(purchaseToken) });
  if (!response.data?.lineItems?.length) throw new Error("Google Play subscription is incomplete");
  return response.data;
}

export async function acknowledgeGooglePurchase(
  purchaseToken: string,
  productId: string,
): Promise<void> {
  const client = await publisherClient().getClient();
  await client.request({
    url: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
      DAD_HEALTH_ANDROID_PACKAGE,
    )}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(
      purchaseToken,
    )}:acknowledge`,
    method: "POST",
    data: {},
  });
}

function googleStatus(state: string | undefined, expiryTime: string | undefined, trialing: boolean): string {
  const now = Date.now();
  const expiry = expiryTime ? Date.parse(expiryTime) : Number.NaN;
  switch (state) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      return trialing ? "trialing" : "active";
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      return "grace_period";
    case "SUBSCRIPTION_STATE_ON_HOLD":
    case "SUBSCRIPTION_STATE_PAUSED":
      return "paused";
    case "SUBSCRIPTION_STATE_PENDING":
      return "pending";
    case "SUBSCRIPTION_STATE_EXPIRED":
      return "expired";
    case "SUBSCRIPTION_STATE_CANCELED":
      return Number.isFinite(expiry) && expiry > now ? "active" : "canceled";
    default:
      return Number.isFinite(expiry) && expiry > now ? (trialing ? "trialing" : "active") : "expired";
  }
}

export function googleEntitlementInput(
  userId: string,
  purchaseToken: string,
  purchase: GoogleSubscriptionPurchase,
): SubscriptionEntitlementInput {
  const lineItem = purchase.lineItems?.reduce<GoogleLineItem | null>((latest, item) => {
    if (!latest) return item;
    return Date.parse(item.expiryTime ?? "") > Date.parse(latest.expiryTime ?? "") ? item : latest;
  }, null);
  if (!lineItem?.productId || !lineItem.offerDetails?.basePlanId) {
    throw new Error("Google Play subscription is incomplete");
  }
  const plan = requireKnownGooglePlan(lineItem.productId, lineItem.offerDetails.basePlanId);
  const trialing = isKnownGoogleTrialOffer(lineItem.offerDetails.offerId);
  const status = googleStatus(purchase.subscriptionState, lineItem.expiryTime, trialing);

  return {
    userId,
    provider: "google",
    providerSubscriptionId: purchaseToken,
    providerAccountId: purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    latestTransactionId: lineItem.latestSuccessfulOrderId ?? purchase.latestOrderId ?? null,
    productId: lineItem.productId,
    plan,
    status,
    currentPeriodEnd: lineItem.expiryTime ?? null,
    trialEnd: status === "trialing" ? lineItem.expiryTime ?? null : null,
    autoRenews: lineItem.autoRenewingPlan?.autoRenewEnabled ?? false,
    environment: purchase.testPurchase ? "test" : "production",
    lastVerifiedAt: new Date().toISOString(),
  };
}

export async function verifyGoogleRtdnIdentity(authorization: string | null): Promise<void> {
  const audience = process.env.GOOGLE_RTDN_AUDIENCE?.trim();
  const expectedEmail = process.env.GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL?.trim();
  if (!audience || !expectedEmail) {
    throw new SubscriptionConfigurationError("Google Play notifications are not configured");
  }
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("Missing Google notification identity");
  const ticket = await new OAuth2Client().verifyIdToken({ idToken: token, audience });
  const payload = ticket.getPayload();
  if (!payload?.email_verified || payload.email !== expectedEmail) {
    throw new Error("Invalid Google notification identity");
  }
}
