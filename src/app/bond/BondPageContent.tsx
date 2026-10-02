"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import CoParentInviteAccept from "@/components/CoParentInviteAccept";
import CoParenting from "@/components/CoParenting";
import HomepageFooter from "@/components/homepage/HomepageFooter";
import HomepageHeader from "@/components/homepage/HomepageHeader";

type InvitePreview = {
  inviterDisplayName?: string | null;
  error?: string;
};

export default function BondPageContent() {
  const searchParams = useSearchParams();
  const section = searchParams.get("section");
  const token = searchParams.get("token");
  const isCoParenting = section === "coparenting";
  const isInvite = isCoParenting && Boolean(token);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(isInvite);

  useEffect(() => {
    if (!isInvite || !token) return;

    const controller = new AbortController();
    setPreviewLoading(true);

    void fetch("/api/co-parenting/invite/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as InvitePreview;
        setPreview(
          response.ok
            ? data
            : { error: data.error || "This invite link is invalid or has expired" }
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPreview({ error: "Unable to check this invite. Please try again." });
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });

    return () => controller.abort();
  }, [isInvite, token]);

  let content: ReactNode;

  if (isInvite && token) {
    if (previewLoading) {
      content = (
        <section className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-6 lg:py-20">
          <p className="text-sm text-muted-foreground">Checking invitation...</p>
        </section>
      );
    } else if (preview?.error) {
      content = (
        <section className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-6 lg:py-20">
          <h1 className="font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">
            Invitation unavailable
          </h1>
          <p className="mt-5 text-muted-foreground">{preview.error}</p>
          <Link
            href="/bond?section=coparenting"
            className="mt-8 inline-flex min-h-11 items-center bg-primary px-5 font-heading text-sm font-extrabold uppercase tracking-wider text-primary-foreground"
          >
            Open shared calendar
          </Link>
        </section>
      );
    } else {
      content = (
        <CoParentInviteAccept token={token} invitedByName={preview?.inviterDisplayName} />
      );
    }
  } else if (isCoParenting) {
    content = (
      <section className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="mb-8 max-w-4xl">
          <h1 className="font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">
            Shared parenting calendar
          </h1>
          <p className="mt-4 text-muted-foreground">
            View shared parenting dates, handovers and upcoming events.
          </p>
        </div>
        <CoParenting />
      </section>
    );
  } else {
    content = (
      <section className="mx-auto flex w-full max-w-7xl flex-1 items-center px-5 py-20 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="font-heading text-sm font-extrabold uppercase tracking-[0.18em] text-primary">
            Bond
          </p>
          <h1 className="mt-4 font-heading text-5xl font-extrabold uppercase leading-[0.92] sm:text-6xl">
            Bond lives in the Dad Health app.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
            Use the app for Dad Days, milestones, Present Dad Mode and Cook Together.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/#download"
              className="inline-flex min-h-11 items-center bg-primary px-5 font-heading text-sm font-extrabold uppercase tracking-wider text-primary-foreground"
            >
              Get the app
            </Link>
            <Link
              href="/bond?section=coparenting"
              className="inline-flex min-h-11 items-center border border-border px-5 font-heading text-sm font-extrabold uppercase tracking-wider text-foreground"
            >
              Shared calendar
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden bg-background text-foreground">
      <HomepageHeader />
      <main className="flex flex-1 flex-col">{content}</main>
      <HomepageFooter />
    </div>
  );
}
