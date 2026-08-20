import type { SubscriptionPlan } from "./types";

export const DAD_HEALTH_BUNDLE_ID = "co.uk.dadhealth";
export const DAD_HEALTH_ANDROID_PACKAGE = "co.uk.dadhealth";

export class SubscriptionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionConfigurationError";
  }
}

function configured(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

export function requireAppleProductIds() {
  const monthly = configured("APPLE_IAP_PRO_MONTHLY_PRODUCT_ID");
  const annual = configured("APPLE_IAP_PRO_ANNUAL_PRODUCT_ID");
  if (!monthly || !annual) {
    throw new SubscriptionConfigurationError("Apple subscription products are not configured");
  }
  return { monthly, annual };
}

export function requireKnownAppleProduct(productId: string): SubscriptionPlan {
  const products = requireAppleProductIds();
  if (productId === products.monthly) return "monthly";
  if (productId === products.annual) return "annual";
  throw new Error("Unexpected Apple subscription product");
}

export function requireGoogleProductConfig() {
  const productId = configured("GOOGLE_PLAY_PRO_PRODUCT_ID");
  const monthlyBasePlanId = configured("GOOGLE_PLAY_PRO_MONTHLY_BASE_PLAN_ID");
  const annualBasePlanId = configured("GOOGLE_PLAY_PRO_ANNUAL_BASE_PLAN_ID");
  const monthlyTrialOfferId = configured("GOOGLE_PLAY_PRO_MONTHLY_TRIAL_OFFER_ID");
  const annualTrialOfferId = configured("GOOGLE_PLAY_PRO_ANNUAL_TRIAL_OFFER_ID");
  if (!productId || !monthlyBasePlanId || !annualBasePlanId) {
    throw new SubscriptionConfigurationError("Google Play subscription products are not configured");
  }
  return {
    productId,
    monthlyBasePlanId,
    annualBasePlanId,
    monthlyTrialOfferId,
    annualTrialOfferId,
  };
}

export function requireKnownGooglePlan(
  productId: string,
  basePlanId: string | null | undefined,
): SubscriptionPlan {
  const config = requireGoogleProductConfig();
  if (productId !== config.productId) throw new Error("Unexpected Google Play product");
  if (basePlanId === config.monthlyBasePlanId) return "monthly";
  if (basePlanId === config.annualBasePlanId) return "annual";
  throw new Error("Unexpected Google Play base plan");
}

export function isKnownGoogleTrialOffer(offerId: string | null | undefined): boolean {
  if (!offerId) return false;
  const config = requireGoogleProductConfig();
  return offerId === config.monthlyTrialOfferId || offerId === config.annualTrialOfferId;
}
