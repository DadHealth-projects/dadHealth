"use client";

import Script from "next/script";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ANALYTICS_CONSENT_KEY,
  ANALYTICS_SETTINGS_EVENT,
  initAnalytics,
  type AnalyticsConsentValue,
  withdrawAnalyticsConsent,
} from "@/lib/analytics";

type ConsentState = AnalyticsConsentValue | "loading" | "unset";

export default function AnalyticsConsent() {
  const choicesRef = useRef<HTMLElement>(null);
  const [consent, setConsent] = useState<ConsentState>("loading");
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    initAnalytics(); // Resume revocation receipts even when consent remains denied.
    try {
      const stored = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
      if (stored === "granted" || stored === "denied") {
        setConsent(stored);
        if (stored === "granted") initAnalytics();
        return;
      }
    } catch {
      setConsent("denied");
      return;
    }

    setConsent("unset");
  }, []);

  useEffect(() => {
    function openSettings() {
      setSettingsOpen(true);
    }

    window.addEventListener(ANALYTICS_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(ANALYTICS_SETTINGS_EVENT, openSettings);
  }, []);

  useEffect(() => {
    if (settingsOpen) choicesRef.current?.focus();
  }, [settingsOpen]);

  function chooseConsent(value: AnalyticsConsentValue) {
    try {
      window.localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
    } catch {
      setConsent("denied");
      return;
    }

    const withdrawing = consent === "granted" && value === "denied";

    setConsent(value);
    setSettingsOpen(false);

    if (value === "granted") {
      initAnalytics(true);
      return;
    }

    if (withdrawing) {
      withdrawAnalyticsConsent();
      window.location.reload();
    }
  }

  return (
    <>
      {consent === "granted" && (
        <Script
          id="gtm-script"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-K6SX8SKZ');`,
          }}
        />
      )}

      {(consent === "unset" || settingsOpen) && (
        <section
          ref={choicesRef}
          tabIndex={-1}
          aria-label="Analytics cookie choices"
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[100] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 rounded-2xl border border-border bg-card p-5 text-foreground shadow-[0_0_24px_hsl(var(--primary)/0.08)] max-h-[calc(100dvh-2rem)] overflow-y-auto sm:flex sm:items-center sm:gap-6"
        >
          <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
            We use optional analytics to understand how Dad Health is used. Read our{" "}
            <Link href="/cookies" className="text-foreground underline decoration-primary underline-offset-4">
              Cookie Policy
            </Link>
            .
            {settingsOpen && consent !== "unset" ? ` Current choice: ${consent === "granted" ? "allowed" : "rejected"}.` : ""}
          </p>
          <div className="mt-4 flex flex-wrap gap-3 sm:mt-0">
            <button
              type="button"
              onClick={() => chooseConsent("denied")}
              className="inline-flex min-h-11 min-w-0 flex-1 [overflow-wrap:anywhere] items-center justify-center bg-primary px-2 py-2 font-heading text-sm font-extrabold uppercase text-primary-foreground sm:flex-none sm:px-4"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => chooseConsent("granted")}
              className="inline-flex min-h-11 min-w-0 flex-1 [overflow-wrap:anywhere] items-center justify-center bg-primary px-2 py-2 font-heading text-sm font-extrabold uppercase text-primary-foreground sm:flex-none sm:px-4"
            >
              Allow analytics
            </button>
          </div>
        </section>
      )}
    </>
  );
}
