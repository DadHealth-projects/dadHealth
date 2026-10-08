
"use client";

import { useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import {
  marketingBodyClass,
  marketingCardSurfaceClass,
  marketingContainerClass,
  marketingSectionHeadingClass,
} from "@/components/marketing/marketingStyles";

type SubmitState = "idle" | "sending" | "success" | "error";

function fieldValue(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

export default function BusinessEnquiry({
  headingLevel: Heading = "h2",
}: {
  headingLevel?: "h1" | "h2";
}) {
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitState === "sending") return;

    const formElement = event.currentTarget;

    if (!formElement.reportValidity()) return;

    const form = new FormData(formElement);

    setSubmitState("sending");
    setErrorMessage("");

    try {
      const response = await fetch("/api/business/enquiry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: fieldValue(form, "name"),
          company: fieldValue(form, "company"),
          email: fieldValue(form, "email"),
          size: fieldValue(form, "size"),
          message: fieldValue(form, "message"),
        }),
      });

      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error || "Unable to send enquiry");
      }

      formElement.reset();
      setSubmitState("success");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to send enquiry"
      );
      setSubmitState("error");
    }
  }

  const inputClasses =
    "mt-2 min-h-12 w-full rounded-xl border border-input bg-background px-4 py-3 text-foreground shadow-[0_0_16px_hsl(var(--primary)/0.03)] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <section
      id="contact"
      className="scroll-mt-14 border-t border-border bg-card text-foreground"
    >
      <div
        className={`${marketingContainerClass} grid gap-10 py-14 sm:py-16 ${
          submitState === "success"
            ? "mx-auto max-w-4xl lg:py-20"
            : "lg:grid-cols-2 lg:gap-8 lg:py-16 xl:gap-12 min-[1440px]:gap-16 min-[1440px]:py-20"
        }`}
      >
        {submitState !== "success" && (
          <div>
            <Heading className={marketingSectionHeadingClass}>
              Let&apos;s talk
            </Heading>

            <p className={`mt-5 max-w-xl ${marketingBodyClass}`}>
              Tell us a little about your organisation and
              we&apos;ll come back within two working days
              with a plan and a price.
            </p>

            <p className="mt-6 text-[15px] sm:text-base">
              Or email{" "}
              <a
                href="mailto:hello@dadhealth.co.uk"
                className="text-primary hover:underline"
              >
                hello@dadhealth.co.uk
              </a>
            </p>
          </div>
        )}

        <div
          className={`${marketingCardSurfaceClass} ${
            submitState === "success"
              ? "p-6 sm:p-10 lg:p-12"
              : "p-5 sm:p-7"
          }`}
        >
          {submitState === "success" ? (
            <div
              role="status"
              className="flex min-h-[360px] flex-col items-center justify-center text-center"
            >
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
                <Check
                  className="h-11 w-11 text-emerald-600"
                  strokeWidth={3.5}
                  aria-hidden="true"
                />
              </div>

              <h2 className="mt-7 font-heading text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                Enquiry submitted!
              </h2>

              <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
                Thanks for reaching out! We&apos;ve received
                your enquiry and our team will review it.
              </p>

              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                We&apos;ll be in touch within two working days.
              </p>

              <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href="/business"
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-primary bg-primary px-6 py-3 font-heading text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Back to business
                </a>

                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage("");
                    setSubmitState("idle");
                  }}
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border bg-muted px-6 py-3 font-heading text-sm font-bold text-foreground transition-colors hover:bg-accent hover:text-black"
                >
                  Submit another enquiry
                </button>
              </div>

              <div className="mt-9 w-full border-t border-border pt-5">
                <p className="text-sm text-muted-foreground">
                  Need help? Contact{" "}
                  <a
                    href="mailto:hello@dadhealth.co.uk"
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    hello@dadhealth.co.uk
                  </a>
                </p>
              </div>
            </div>
          ) : (
            <form
              method="post"
              action="/api/business/enquiry"
              onSubmit={handleSubmit}
            >
              <label className="block text-sm text-muted-foreground">
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={100}
                  className={inputClasses}
                />
              </label>

              <label className="mt-4 block text-sm text-muted-foreground">
                Company
                <input
                  name="company"
                  autoComplete="organization"
                  required
                  maxLength={150}
                  className={inputClasses}
                />
              </label>

              <label className="mt-4 block text-sm text-muted-foreground">
                Work email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  className={inputClasses}
                />
              </label>

              <label className="mt-4 block text-sm text-muted-foreground">
                Roughly how many employees would Dad Health
                be available to?
                <select
                  name="size"
                  required
                  className={inputClasses}
                >
                  <option>Under 25</option>
                  <option>25–99</option>
                  <option>100–249</option>
                  <option>250+</option>
                </select>
              </label>

              <label className="mt-4 block text-sm text-muted-foreground">
                Anything we should know?
                <textarea
                  name="message"
                  maxLength={4000}
                  className={`${inputClasses} min-h-28 resize-y`}
                />
              </label>

              <button
                type="submit"
                disabled={submitState === "sending"}
                className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl border border-primary bg-primary px-6 font-heading text-lg font-extrabold uppercase tracking-[0.06em] text-primary-foreground shadow-[0_0_18px_hsl(var(--primary)/0.10)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitState === "sending"
                  ? "Sending..."
                  : "Send enquiry"}
              </button>

              <div
                aria-live="polite"
                className="mt-3 min-h-5 text-sm"
              >
                {submitState === "error" && (
                  <p className="text-destructive">
                    {errorMessage}
                  </p>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}