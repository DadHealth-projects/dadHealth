"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { trackEvent } from "@/lib/analytics";

export type WeeklyChallengeItem = {
  id: string;
  title: string;
  description: string | null;
  participants_count: number;
  participationStatus: "not_joined" | "joined" | "completed" | "unavailable";
};

type WeeklyChallengeScreenProps = {
  isFullDashboard: boolean;
  userId?: string;
  challenge: WeeklyChallengeItem | null;
  busy: boolean;
  onBack: () => void;
  onRetry: () => Promise<void>;
  onParticipationChange: (join: boolean) => Promise<void>;
  onComplete: () => Promise<void>;
};

const STARTED_KEY_PREFIX = "dadhealth.weekly-challenge.started";

function startedKey(userId: string, challengeId: string) {
  return `${STARTED_KEY_PREFIX}.${userId}.${challengeId}`;
}

function completionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("challenge_not_active")
    ? "This Weekly Challenge has ended and can no longer be completed."
    : "We couldn't mark this challenge as completed. Please try again.";
}

export default function WeeklyChallengeScreen({
  isFullDashboard,
  userId,
  challenge,
  busy,
  onBack,
  onRetry,
  onParticipationChange,
  onComplete,
}: WeeklyChallengeScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const [locallyStarted, setLocallyStarted] = useState(false);
  const localStartedKey = userId && challenge ? startedKey(userId, challenge.id) : null;

  useEffect(() => {
    setError(null);
    setLocallyStarted(false);

    if (!localStartedKey || !challenge || typeof window === "undefined") return;

    if (challenge.participationStatus === "completed" || challenge.participationStatus === "not_joined") {
      try {
        window.localStorage.removeItem(localStartedKey);
      } catch {
        // Completion and database participation remain authoritative.
      }
      return;
    }

    if (challenge.participationStatus === "joined") {
      try {
        setLocallyStarted(window.localStorage.getItem(localStartedKey) === "true");
      } catch {
        setLocallyStarted(false);
      }
    }
  }, [challenge, localStartedKey]);

  const clearLocalStartedState = () => {
    setLocallyStarted(false);
    if (!localStartedKey || typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(localStartedKey);
    } catch {
      // A completed or removed participation still wins over stale local state.
    }
  };

  const changeParticipation = async (join: boolean) => {
    setError(null);
    try {
      await onParticipationChange(join);
      if (!join) clearLocalStartedState();
    } catch {
      setError(
        join
          ? "We couldn't add you to this week's challenge. Please try again."
          : "We couldn't remove you from this week's challenge. Please try again.",
      );
    }
  };

  const start = () => {
    setError(null);

    if (!localStartedKey || typeof window === "undefined") {
      setError("We couldn't remember that you started this challenge. Please try again.");
      return;
    }

    try {
      window.localStorage.setItem(localStartedKey, "true");
      setLocallyStarted(true);
      trackEvent("weekly_challenge_started", { challenge_id: challenge?.id });
    } catch {
      setError("We couldn't remember that you started this challenge. Please try again.");
    }
  };

  const complete = async () => {
    setError(null);
    try {
      await onComplete();
      clearLocalStartedState();
    } catch (completionError) {
      setError(completionErrorMessage(completionError));
    }
  };

  if (!challenge) {
    return (
      <div className={`col-span-2 bg-card p-5 ${isFullDashboard ? "min-h-full" : ""}`}>
        <button
          type="button"
          onClick={onBack}
          className="mb-5 inline-flex items-center gap-2 font-heading text-[11px] font-bold uppercase tracking-wider text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Home
        </button>
        <span className="section-label !p-0">This week&apos;s challenge</span>
        <h2 className="mt-2 font-heading text-[28px] font-extrabold uppercase text-foreground">
          No active challenge
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          The next Weekly Challenge will appear here when it is ready.
        </p>
      </div>
    );
  }

  const status = challenge.participationStatus === "completed"
    ? "completed"
    : challenge.participationStatus === "joined" && locallyStarted
      ? "started"
      : challenge.participationStatus;
  const experienceCopy = status === "completed"
    ? {
        title: "Challenge completed",
        description: "You showed up this week.",
      }
    : status === "started"
      ? {
          title: "Challenge on",
          description: "Go do it. Come back when you're done.",
        }
      : status === "joined"
        ? {
            title: "You're in",
            description: "You made the commitment. Now make it count.",
          }
        : {
            title: "Ready for this week?",
            description: "One challenge. One week. A chance to show up where it matters.",
          };

  return (
    <div className={`col-span-2 bg-card p-5 ${isFullDashboard ? "min-h-full" : ""}`}>
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-2 font-heading text-[11px] font-bold uppercase tracking-wider text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Home
      </button>

      <span className="section-label !p-0">This week&apos;s challenge</span>
      <h2 className="mt-2 max-w-3xl font-heading text-[32px] font-extrabold uppercase leading-tight text-foreground">
        {experienceCopy.title}
      </h2>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
        {experienceCopy.description}
      </p>

      <div className="mt-7 max-w-2xl border-t border-border pt-6">
        {status === "unavailable" ? (
          <div>
            <p role="alert" className="text-sm leading-6 text-red-400">
              We couldn&apos;t check your challenge status. Please try again.
            </p>
            <button
              type="button"
              onClick={() => void onRetry()}
              disabled={busy}
              className="mt-4 bg-primary px-5 py-3 font-heading text-[12px] font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-50"
            >
              Try again
            </button>
          </div>
        ) : status === "not_joined" ? (
          <div>
            <p className="font-heading text-sm font-bold uppercase tracking-wide text-primary">
              This week&apos;s mission
            </p>
            <h3 className="mt-3 font-heading text-[24px] font-extrabold uppercase text-foreground">
              {challenge.title}
            </h3>
            {challenge.description ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                {challenge.description}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void changeParticipation(true)}
              disabled={busy}
              className="mt-5 bg-primary px-5 py-3 font-heading text-[12px] font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Joining…" : "I'm in"}
            </button>
          </div>
        ) : status === "completed" ? (
          <div>
            <CheckCircle2 className="h-8 w-8 text-primary" aria-hidden="true" />
          </div>
        ) : status === "started" ? (
          <div>
            <p className="font-heading text-sm font-bold uppercase tracking-wide text-primary">
              Your challenge
            </p>
            <h3 className="mt-3 font-heading text-[24px] font-extrabold uppercase text-foreground">
              {challenge.title}
            </h3>
            {challenge.description ? (
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-foreground">
                {challenge.description}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void complete()}
              disabled={busy}
              className="mt-5 bg-primary px-5 py-3 font-heading text-[12px] font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Completing…" : "I did it"}
            </button>
          </div>
        ) : (
          <div>
            <p className="font-heading text-sm font-bold uppercase tracking-wide text-primary">
              Your challenge
            </p>
            <h3 className="mt-3 font-heading text-[24px] font-extrabold uppercase text-foreground">
              {challenge.title}
            </h3>
            {challenge.description ? (
              <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                {challenge.description}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void start()}
                disabled={busy}
                className="bg-primary px-5 py-3 font-heading text-[12px] font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-50"
              >
                Start challenge
              </button>
              <button
                type="button"
                onClick={() => void changeParticipation(false)}
                disabled={busy}
                className="border border-border px-5 py-3 font-heading text-[11px] font-bold uppercase tracking-wider text-muted-foreground disabled:opacity-50"
              >
                {busy ? "Updating…" : "Leave challenge"}
              </button>
            </div>
          </div>
        )}

        {error ? (
          <p role="alert" className="mt-4 text-sm leading-6 text-red-400">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
