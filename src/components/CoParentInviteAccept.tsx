"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import AuthModal from "@/components/AuthModal";

export default function CoParentInviteAccept({
  token,
  invitedByName,
}: {
  token: string;
  invitedByName?: string | null;
}) {

  const router = useRouter();
  const { user } = useAuth();

  const [invitedByNameState] = useState<string>(invitedByName ?? "Someone");
  const [submitting, setSubmitting] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const returnTo = `/bond?section=coparenting&token=${encodeURIComponent(token)}`;

  async function handleAccept() {

    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/co-parenting/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Unable to accept invite");
      }

      toast({ description: "Invite accepted." });

// IMPORTANT: remove token + force full reload of Bond page
window.location.replace("/bond?section=coparenting");
    } catch (e) {
      toast({
        description: e instanceof Error ? e.message : "Unable to accept invite",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-[720px] mx-auto px-4 sm:px-5 py-10">
      <div className="flex items-center gap-3 mb-6">
        <img src="/LOGO.png" alt="Dad Health" className="h-10 w-auto" />
      </div>

      <h1 className="font-heading text-[28px] sm:text-[34px] font-extrabold text-foreground leading-none mb-3">
        You&apos;ve been invited to share a parenting calendar.
      </h1>

      <p className="text-sm text-muted-foreground mb-7">
        {invitedByNameState} has invited you to connect on Dad Health.

      </p>


      <div className="rounded-lg border border-border bg-card p-5 mb-7">
        <h2 className="font-heading text-[14px] font-extrabold uppercase tracking-wide text-foreground mb-2">
          What it means
        </h2>

        <p className="text-sm text-foreground/70 leading-relaxed">
          You&apos;ll be able to share a parenting calendar, coordinate parenting time, and
          see shared milestone moments.
        </p>

        <p className="text-sm text-foreground/70 leading-relaxed mt-2">
          Your data stays private — only shared events are visible to each other.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {user ? (
          <button
            type="button"
            onClick={handleAccept}
            disabled={submitting}
            className="flex-1 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:brightness-110 disabled:opacity-50"
          >
            {submitting ? "Accepting..." : "Accept and log in"}
          </button>
        ) : (
          <button
            type="button"
            disabled={submitting}
            onClick={() => setAuthOpen(true)}
            className="flex-1 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:brightness-110 disabled:opacity-50"
          >
            Accept and create account
          </button>
        )}

        <button
          type="button"
          onClick={() => router.push("/bond?section=coparenting")}
          className="flex-1 inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-bold text-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Not now
        </button>
      </div>

      <p className="text-xs text-muted-foreground mt-5">This invite link expires in 7 days.</p>
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSuccess={() => setAuthOpen(false)}
        returnTo={returnTo}
      />
    </div>
  );
}

