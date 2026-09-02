"use client";

import { useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/hooks/useUserProfile";

declare global {
  interface Window {
    OneSignal?: any;
    OneSignalDeferred?: Array<(oneSignal: any) => void | Promise<void>>;
    __onesignalScriptAdded?: boolean;
    __onesignalInitialized?: boolean;
    __onesignalInitPromise?: Promise<void>;
  }
}

function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function ensureOneSignalScript(appId: string): void {
  if (typeof window === "undefined") return;
  if (!appId) return; // Don't load SDK if App ID is missing — avoids ERR_CONNECTION_CLOSED spam
  if (window.__onesignalScriptAdded) return;
  window.__onesignalScriptAdded = true;

  const s = document.createElement("script");
  s.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
  s.async = true;
  document.head.appendChild(s);
}

function queueOneSignal(cb: (oneSignal: any) => void | Promise<void>) {
  if (typeof window === "undefined") return;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(cb);
}

function normalizeSiteOrigin(input: string): string {
  const t = input.trim().replace(/\/+$/, "");
  if (!t) return t;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function canUseOneSignalOnCurrentOrigin(): boolean {
  if (typeof window === "undefined") return false;
  const currentOrigin = window.location.origin.replace(/\/+$/, "");
  const explicitAllowedOrigin = process.env.NEXT_PUBLIC_ONESIGNAL_ALLOWED_ORIGIN?.trim();

  // If explicitly configured, require match (host-only values like www.example.com → https://www.example.com).
  if (explicitAllowedOrigin) {
    return currentOrigin === normalizeSiteOrigin(explicitAllowedOrigin);
  }

  // Allow production domain and localhost for development.
  const ALLOWED = [
    "https://www.dadhealth.co.uk",
    "https://dadhealth.co.uk",
    "http://localhost:3000",
    "http://localhost:8080",
    "http://localhost:3001",
  ];
  return ALLOWED.includes(currentOrigin);
}

function getOneSignalAppId(): string {
  return process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID?.trim() || "";
}

function isOneSignalAlreadyInitializedError(err: unknown): boolean {
  return err instanceof Error
    ? /sdk already initialized/i.test(err.message)
    : /sdk already initialized/i.test(String(err));
}

async function initOneSignalOnce(oneSignal: any, appId: string): Promise<void> {
  if (!appId) return;
  if (window.__onesignalInitialized) return;
  if (!window.__onesignalInitPromise) {
    window.__onesignalInitPromise = (async () => {
      try {
        await oneSignal.init({
          appId,
          allowLocalhostAsSecureOrigin: true,
        });
        window.__onesignalInitialized = true;
      } catch (err) {
        // Another consumer may have initialized the singleton before this callback ran.
        if (isOneSignalAlreadyInitializedError(err)) {
          window.__onesignalInitialized = true;
          return;
        }
        // Reset promise so a future retry is possible (e.g. after network recovery)
        window.__onesignalInitPromise = undefined;
        console.warn("[OneSignal] init failed — check NEXT_PUBLIC_ONESIGNAL_APP_ID and OneSignal dashboard origin settings.", err);
      }
    })();
  }
  await window.__onesignalInitPromise;
}

export function requestOneSignalPermission() {
  if (typeof window === "undefined") return;
  if (!canUseOneSignalOnCurrentOrigin()) return;
  const appId = getOneSignalAppId();
  if (!appId) {
    console.warn("[OneSignal] requestOneSignalPermission called but NEXT_PUBLIC_ONESIGNAL_APP_ID is not set.");
    return;
  }
  ensureOneSignalScript(appId);

  queueOneSignal(async (OneSignal) => {
    await initOneSignalOnce(OneSignal, appId);

    // v16 path
    if (OneSignal?.Notifications?.requestPermission) {
      await OneSignal.Notifications.requestPermission();
      return;
    }
    // Older fallbacks
    if (typeof OneSignal?.showSlidedownPrompt === "function") OneSignal.showSlidedownPrompt();
    else if (typeof OneSignal?.registerForPushNotifications === "function") OneSignal.registerForPushNotifications();
    else if (typeof OneSignal?.showNativePrompt === "function") OneSignal.showNativePrompt();
  });
}

export default function OneSignalManager() {
  const { user } = useAuth();
  const { data: profile } = useUserProfile(user?.id);

  const appId = useMemo(() => getOneSignalAppId(), []);
  const enabled = Boolean(profile?.push_notifications_enabled);

  useEffect(() => {
    if (!user) return;
    if (!enabled) return;
    if (!appId) return;
    if (!canUseOneSignalOnCurrentOrigin()) return;

    ensureOneSignalScript(appId);

    queueOneSignal(async (OneSignal) => {
      await initOneSignalOnce(OneSignal, appId);

      // v16 login identity, fallback for older SDK signatures.
      if (typeof OneSignal.login === "function") {
        await OneSignal.login(user.id);
      } else if (typeof OneSignal.setExternalUserId === "function") {
        OneSignal.setExternalUserId(user.id);
      }
    });
  }, [user, enabled, appId]);

  // Opportunistically persist timezone (used server-side for scheduling).
  useEffect(() => {
    // Settings page will explicitly set this too; this just helps new users.
    if (!user) return;
    if (!profile) return;
    const tz = getBrowserTimeZone();
    if (!tz) return;
    if (profile.timezone && profile.timezone.trim() === tz) return;
    // Avoid calling mutations here to keep this component passive.
  }, [user, profile]);

  return null;
}