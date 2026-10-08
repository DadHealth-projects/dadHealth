"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { homepagePrimaryButtonClass } from "@/components/homepage/HomepagePrimaryButton";

type FormState = "idle" | "sending" | "success" | "error";

export default function HomepageWaitlist({ headingLevel: Heading = "h2" }: { headingLevel?: "h1" | "h2" }) {
  const [state, setState] = useState<FormState>("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending") return;

    setState("sending");
    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: data.get("firstName"),
          email: data.get("email"),
          website: data.get("website"),
        }),
      });

      if (!response.ok) throw new Error("Waitlist request failed");
      form.reset();
      setState("success");
    } catch {
      setState("error");
    }
  }

  return (
    <section id="waitlist" className="scroll-mt-14 border-t border-border bg-card text-foreground">
      <span id="download" className="sr-only" aria-hidden="true" />
      <div className="mx-auto grid max-w-7xl gap-7 px-5 py-14 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-end lg:gap-12 lg:px-8">
        <div>
          <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary">Dad Health app</p>
          <Heading className="mt-4 font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl">Join the waitlist.</Heading>
        </div>

        {state === "success" ? (
          <div role="status" className="rounded-2xl border border-primary bg-background p-6 shadow-[0_0_20px_hsl(var(--primary)/0.06)]">
            <p className="font-heading text-2xl font-extrabold uppercase text-primary">You&apos;re on the waitlist.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="waitlist-first-name" className="font-heading text-xs font-bold uppercase tracking-[0.12em]">First name <span className="text-muted-foreground">(optional)</span></label>
              <input id="waitlist-first-name" name="firstName" type="text" autoComplete="given-name" maxLength={100} className="mt-2 min-h-12 w-full rounded-xl border border-border bg-background px-4 text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label htmlFor="waitlist-email" className="font-heading text-xs font-bold uppercase tracking-[0.12em]">Email</label>
              <input id="waitlist-email" name="email" type="email" autoComplete="email" required maxLength={254} className="mt-2 min-h-12 w-full rounded-xl border border-border bg-background px-4 text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary" />
            </div>
            <div className="sr-only" aria-hidden="true">
              <label htmlFor="waitlist-website">Website</label>
              <input id="waitlist-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
            </div>
            <div className="flex flex-col items-center sm:col-span-2 sm:flex-row sm:justify-between sm:gap-5">
              <p className="text-xs text-muted-foreground"><Link href="/privacy" className="min-h-11 items-center underline decoration-primary underline-offset-4 sm:inline-flex">Privacy policy</Link></p>
              <button
  type="submit"
  disabled={state === "sending"}
  className={`${homepagePrimaryButtonClass} mx-auto mt-3 sm:mx-0 sm:mt-0`}
>
  {state === "sending" ? "Joining..." : "Join the waitlist"}
</button>
            </div>
            {state === "error" && <p role="alert" className="text-sm text-destructive sm:col-span-2">We could not join the waitlist. Please try again.</p>}
          </form>
        )}
      </div>
    </section>
  );
}
