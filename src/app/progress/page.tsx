"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import SitePageShell from "@/components/SitePageShell";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/utils/supabaseClient";

type CurrentScore = {
  mind_score: number | null;
  body_score: number | null;
  bond_score: number | null;
  total_score: number | null;
};

function displayScore(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : "—";
}

export default function ProgressPage() {
  const { user, loading: authLoading, openAuthModal } = useAuth();
  const { data: score, error, isLoading } = useQuery({
    queryKey: ["progress-current-score", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error: scoreError } = await supabase
        .from("dad_score_view")
        .select("mind_score,body_score,bond_score,total_score")
        .eq("user_id", user.id)
        .maybeSingle();
      if (scoreError) throw scoreError;
      return data as CurrentScore | null;
    },
    enabled: Boolean(user?.id),
  });

  return (
    <SitePageShell>
      <section className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-6 lg:px-8 lg:py-16">
        <p className="section-label !p-0">Dad Health Score</p>
        <h1 className="mt-4 font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">
          Your current score
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Your current Mind, Body and Bond scores from Dad Health.
        </p>

        {!authLoading && !user ? (
          <div className="mt-10 border border-border bg-card p-6 sm:p-8">
            <h2 className="font-heading text-2xl font-extrabold uppercase">Sign in required</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Sign in to view your current Dad Health Score.
            </p>
            <button
              type="button"
              onClick={openAuthModal}
              className="mt-6 inline-flex min-h-11 items-center bg-primary px-5 font-heading text-sm font-extrabold uppercase tracking-wider text-primary-foreground"
            >
              Sign in
            </button>
          </div>
        ) : user ? (
          <div className="mt-10">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading your score...</p>
            ) : error ? (
              <p role="alert" className="text-sm text-destructive">
                Your score is temporarily unavailable. Please try again.
              </p>
            ) : (
              <div className="border border-border bg-card p-6 sm:p-8">
                <div className="flex flex-col gap-8 sm:flex-row sm:items-center">
                  <div className="flex size-32 shrink-0 flex-col items-center justify-center rounded-full border-4 border-primary">
                    <span className="font-heading text-5xl font-extrabold leading-none text-primary">
                      {displayScore(score?.total_score)}
                    </span>
                    <span className="mt-1 font-heading text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      out of 100
                    </span>
                  </div>

                  <dl className="grid flex-1 gap-3 sm:grid-cols-3">
                    {[
                      ["Mind", score?.mind_score],
                      ["Body", score?.body_score],
                      ["Bond", score?.bond_score],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="border border-border px-4 py-5">
                        <dt className="font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          {label}
                        </dt>
                        <dd className="mt-2 font-heading text-3xl font-extrabold text-primary">
                          {displayScore(value as number | null | undefined)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {!score && (
                  <p className="mt-6 text-sm text-muted-foreground">
                    Your score will appear after Dad Health has enough activity to calculate it.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="mt-10 text-sm text-muted-foreground">Checking account...</p>
        )}

        <div className="mt-10 flex flex-wrap gap-3 border-t border-border pt-8">
          <Link
            href="/#download"
            className="inline-flex min-h-11 items-center bg-primary px-5 font-heading text-xs font-bold uppercase tracking-wider text-primary-foreground"
          >
            Get the app
          </Link>
          <Link
            href="/pricing"
            className="inline-flex min-h-11 items-center border border-primary px-5 font-heading text-xs font-bold uppercase tracking-wider text-primary"
          >
            Manage Pro
          </Link>
        </div>
      </section>
    </SitePageShell>
  );
}
