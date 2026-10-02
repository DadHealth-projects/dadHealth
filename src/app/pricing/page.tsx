"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import SitePageShell from "@/components/SitePageShell";
import LimeButton from "@/components/LimeButton";
import LoginPromptModal from "@/components/LoginPromptModal";
import { useProStatus } from "@/components/ProProvider";
import { useAuth } from "@/contexts/AuthContext";

type CheckoutState = "success" | "canceled" | null;

export default function PricingPage() {
  const [checkoutState, setCheckoutState] = useState<CheckoutState>(null);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const { user, openAuthModal } = useAuth();
  const { isPro, startCheckout, refreshSubscription } = useProStatus();
  const isActivePro = Boolean(user && isPro);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");

    if (checkout === "canceled") {
      setCheckoutState("canceled");
      return;
    }
    if (checkout !== "success") return;

    const sessionId = params.get("session_id");
    if (!sessionId?.startsWith("cs_")) {
      window.history.replaceState({}, "", "/pricing");
      return;
    }

    setCheckoutState("success");

    void (async () => {
      let { isPro: unlocked } = await refreshSubscription();
      for (let attempt = 0; attempt < 10 && !unlocked; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        ({ isPro: unlocked } = await refreshSubscription());
      }

      window.history.replaceState({}, "", "/pricing");
    })();
  }, [refreshSubscription]);

  function startAnnualCheckout() {
    if (!user) {
      openAuthModal();
      return;
    }
    void startCheckout("annual");
  }

  function startMonthlyCheckout() {
    if (!user) {
      setShowLoginPrompt(true);
      return;
    }
    void startCheckout("monthly");
  }

  async function manageSubscription() {
    const response = await fetch("/api/stripe/portal", { method: "POST" });
    const data = (await response.json()) as { error?: string; url?: string };

    if (!response.ok) {
      toast.error(typeof data.error === "string" ? data.error : "Could not open billing portal");
      return;
    }
    if (data.url) window.location.href = data.url;
  }

  return (
    <SitePageShell>
      <div className="bg-background text-foreground">
        <section className="mx-auto max-w-3xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          <span className="section-label block">Account billing</span>
          <h1 className="mt-4 font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">
            Dad Health Pro
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Manage your Dad Health Pro subscription or continue to secure Stripe checkout.
          </p>

          {checkoutState === "success" && (
            <div role="status" aria-live="polite" className="mt-8 border border-primary bg-primary/5 p-5">
              <p className="font-heading text-base font-extrabold uppercase">Payment successful</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Your Dad Health Pro subscription is active. Every Pro feature is unlocked across the app—thank you for your support.
              </p>
            </div>
          )}

          {checkoutState === "canceled" && (
            <div role="status" className="mt-8 border border-border bg-card p-5">
              <p className="font-heading text-base font-extrabold uppercase">Checkout canceled</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                No subscription changes were made.
              </p>
            </div>
          )}

          <div className="mt-10 border border-border bg-card p-6 sm:p-8">
            {isActivePro ? (
              <>
                <p className="font-heading text-xl font-extrabold uppercase text-primary">Pro is active</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Your account currently has Dad Health Pro access.
                </p>
                <button
                  type="button"
                  onClick={() => void manageSubscription()}
                  className="mt-6 inline-flex min-h-11 items-center justify-center border border-foreground px-5 font-heading text-sm font-extrabold uppercase transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Manage subscription
                </button>
              </>
            ) : (
              <>
                <p className="font-heading text-xl font-extrabold uppercase">Choose billing period</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Checkout is handled securely by Stripe. Sign in is required before continuing.
                </p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <LimeButton type="button" full onClick={startAnnualCheckout}>
                    Annual billing &rarr;
                  </LimeButton>
                  <button
                    type="button"
                    onClick={startMonthlyCheckout}
                    className="inline-flex min-h-11 w-full items-center justify-center border border-foreground px-5 font-heading text-sm font-extrabold uppercase transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Monthly billing &rarr;
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {showLoginPrompt && (
        <LoginPromptModal
          onClose={() => setShowLoginPrompt(false)}
          onLogin={openAuthModal}
        />
      )}
    </SitePageShell>
  );
}
