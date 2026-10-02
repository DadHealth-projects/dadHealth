"use client";

import posthog from "posthog-js";

type EventProperties = Record<string, unknown>;

export type AnalyticsConsentValue = "granted" | "denied";
export const ANALYTICS_CONSENT_KEY = "dadhealth.analytics-consent";

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

export function initAnalytics() {
  if (!canUseAnalytics() || initialized) return;

  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    capture_pageview: true,
    capture_pageleave: true,
  });

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
