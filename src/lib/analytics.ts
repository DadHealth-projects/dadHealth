"use client";

import posthog from "posthog-js";

type EventProperties = Record<string, unknown>;

export type AnalyticsConsentValue = "granted" | "denied";
export const ANALYTICS_CONSENT_KEY = "dadhealth.analytics-consent";
export const ANALYTICS_SETTINGS_EVENT = "dadhealth:open-cookie-settings";

let initialized = false;

function hasAnalyticsConsent() {
  if (typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem(ANALYTICS_CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

function canUseAnalytics() {
  return hasAnalyticsConsent() && Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

function removeCookie(name: string) {
  const domains = [undefined, window.location.hostname, ".dadhealth.co.uk"];

  for (const domain of domains) {
    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax${domain ? `; domain=${domain}` : ""}`;
  }
}

function removeKnownAnalyticsCookies() {
  if (typeof document === "undefined") return;

  const prefixes = ["_ga", "_gid", "_gat", "_gcl_", "_dc_gtm_", "AMP_TOKEN", "ph_"];
  const cookieNames = document.cookie
    .split(";")
    .map((cookie) => cookie.split("=")[0]?.trim())
    .filter((name): name is string => Boolean(name));

  for (const name of cookieNames) {
    if (prefixes.some((prefix) => name === prefix || name.startsWith(prefix))) {
      removeCookie(name);
    }
  }
}

export function initAnalytics() {
  if (!canUseAnalytics() || initialized) return;

  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    capture_pageview: true,
    capture_pageleave: true,
  });
  posthog.opt_in_capturing();

  initialized = true;
}

export function trackEvent(event: string, properties: EventProperties = {}) {
  if (!canUseAnalytics()) return;
  initAnalytics();
  posthog.capture(event, properties);
}

export function identifyAnalyticsUser(userId: string, properties: EventProperties = {}) {
  if (!canUseAnalytics()) return;
  initAnalytics();
  posthog.identify(userId, properties);
}

export function resetAnalyticsUser() {
  if (typeof window === "undefined" || !initialized) return;
  posthog.reset();
}

export function withdrawAnalyticsConsent() {
  if (typeof window === "undefined") return;

  if (initialized) {
    posthog.reset();
    posthog.opt_out_capturing();
  }

  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({
    event: "analytics_consent_withdrawn",
    analytics_storage: "denied",
    ad_storage: "denied",
  });

  removeKnownAnalyticsCookies();
  initialized = false;
}

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}
