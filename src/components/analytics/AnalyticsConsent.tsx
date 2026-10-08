"use client";

import Script from "next/script";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ANALYTICS_CONSENT_KEY,
  initAnalytics,
  type AnalyticsConsentValue,
} from "@/lib/analytics";

type ConsentState = AnalyticsConsentValue | "loading" | "unset";

export default function AnalyticsConsent() {
  const pathname = usePathname();
  const [consent, setConsent] = useState<ConsentState>("loading");

  useEffect(() => {
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

  function chooseConsent(value: AnalyticsConsentValue) {
    try {
      window.localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
    } catch {
      setConsent("denied");
      return;
    }

    setConsent(value);
    if (value === "granted") initAnalytics();
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

      {consent === "unset" && (
        <section
          aria-label="Analytics cookie choices"
          className={`${pathname === "/cookies" ? "relative mx-auto mb-4 w-[calc(100%-2rem)]" : "fixed inset-x-4 bottom-4 mx-auto"} z-50 max-w-3xl rounded-2xl border border-border bg-card p-5 text-foreground shadow-[0_0_24px_hsl(var(--primary)/0.08)] sm:flex sm:items-center sm:gap-6`}
        >
          <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
            We use optional analytics to understand how Dad Health is used. Read our{" "}
            <Link href="/cookies" className="text-foreground underline decoration-primary underline-offset-4">
              Cookie Policy
            </Link>
            .
          </p>
          <div className="mt-4 flex gap-3 sm:mt-0">
            <button
              type="button"
              onClick={() => chooseConsent("denied")}
              className="inline-flex min-h-11 flex-1 items-center justify-center border border-border px-4 font-heading text-sm font-extrabold uppercase sm:flex-none"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => chooseConsent("granted")}
              className="inline-flex min-h-11 flex-1 items-center justify-center bg-primary px-4 font-heading text-sm font-extrabold uppercase text-primary-foreground sm:flex-none"
            >
              Allow analytics
            </button>
          </div>
        </section>
      )}
    </>
  );
}
