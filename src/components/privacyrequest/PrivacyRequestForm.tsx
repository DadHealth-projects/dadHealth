
"use client";

import { useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { homepagePrimaryButtonClass } from "@/components/homepage/HomepagePrimaryButton";
import {
  marketingBodyClass,
  marketingCardSurfaceClass,
  marketingContainerClass,
  marketingPageHeroClass,
} from "@/components/marketing/marketingStyles";

type SubmitState = "idle" | "sending" | "success" | "error";
type FieldErrors = Partial<Record<"email" | "requestType" | "details", string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const requestTypes = [
  { value: "access", label: "Access my personal data" },
  { value: "correction", label: "Correct my personal data" },
  { value: "deletion", label: "Request deletion" },
  { value: "other", label: "Other privacy enquiry" },
] as const;

export default function PrivacyRequestForm() {
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function validateField(name: keyof FieldErrors, value: string) {
    const trimmedValue = value.trim();

    if (name === "email") {
      if (!trimmedValue) return "Enter your email address.";
      if (trimmedValue.length > 254 || !EMAIL_PATTERN.test(trimmedValue)) {
        return "Enter a valid email address.";
      }
    }

    if (name === "requestType" && !trimmedValue) {
      return "Select a request type.";
    }

    if (name === "details" && trimmedValue.length > 2000) {
      return "Details must be 2,000 characters or fewer.";
    }

    return "";
  }

  function validateForm(form: FormData) {
    const errors: FieldErrors = {};

    (["email", "requestType", "details"] as const).forEach((name) => {
      const error = validateField(name, String(form.get(name) ?? ""));
      if (error) errors[name] = error;
    });

    return errors;
  }

  function clearCorrectedError(name: keyof FieldErrors, value: string) {
    if (!fieldErrors[name] || validateField(name, value)) return;

    setFieldErrors((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (state === "sending") return;

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const errors = validateForm(form);

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setState("idle");
      return;
    }

    setState("sending");
    setErrorMessage("");
    setFieldErrors({});

    try {
      const response = await fetch("/api/privacy-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          email: form.get("email"),
          requestType: form.get("requestType"),
          details: form.get("details"),
          website: form.get("website"),
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(
            "Too many requests. Please try again later."
          );
        }

        if (response.status >= 500) {
          throw new Error(
            "We couldn't send your request right now. Please try again later."
          );
        }

        const result = await response.json().catch(() => null);

        throw new Error(
          typeof result?.error === "string"
            ? result.error
            : "Unable to submit your request."
        );
      }

      formElement.reset();
      setState("success");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );

      setState("error");
    }
  }

  const inputClass =
    "mt-2 min-h-12 w-full rounded-xl border border-input bg-background px-4 py-3 text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary";

  return (
    <section className="bg-background text-foreground">
      <div
        className={`${marketingContainerClass} grid gap-8 py-14 sm:py-16 ${
          state === "success"
            ? "mx-auto max-w-4xl lg:py-20"
            : "lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-12 lg:py-16 min-[1440px]:py-20"
        }`}
      >
        {state !== "success" && (
          <div>
            <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary">
              Privacy
            </p>

            <h1 className={`${marketingPageHeroClass} mt-4`}>
              Privacy request.
            </h1>

            <p className={`${marketingBodyClass} mt-6 max-w-xl`}>
              Use this form to ask about access to, correction of,
              or deletion of your personal data, or to make another
              privacy enquiry.
            </p>

            <p className={`${marketingBodyClass} mt-4 max-w-xl`}>
              This form creates an enquiry only. We may need to
              verify your identity before personal data is
              disclosed, corrected or deleted.
            </p>

            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Do not send passwords or identity documents through
              this form.
            </p>
          </div>
        )}

        <div
          className={`${marketingCardSurfaceClass} ${
            state === "success"
              ? "p-6 sm:p-10 lg:p-12"
              : "p-5 sm:p-7"
          }`}
        >
          {state === "success" ? (
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
                Request submitted!
              </h2>

              <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
                Thanks for reaching out! We've received your
                privacy request and our team will review it.
              </p>

              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                We may need to verify your identity before
                taking action.
              </p>

              <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href="/"
                  className={`${homepagePrimaryButtonClass} inline-flex items-center justify-center text-center`}
                >
                  Back to homepage
                </a>

                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage("");
                    setState("idle");
                  }}
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border bg-muted px-6 py-3 font-heading text-sm font-bold text-foreground transition-colors hover:bg-accent hover:text-black"
                >
                  Submit another request
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
              action="/api/privacy-request"
              onSubmit={handleSubmit}
              noValidate
              className="grid gap-5"
            >
              <div>
                <label
                  htmlFor="privacy-email"
                  className="font-heading text-sm font-bold uppercase tracking-[0.1em]"
                >
                  Email address
                </label>

                <input
                  id="privacy-email"
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={fieldErrors.email ? "privacy-email-error" : undefined}
                  onChange={(event) => clearCorrectedError("email", event.target.value)}
                  className={`${inputClass} ${fieldErrors.email ? "border-destructive focus:border-destructive focus:ring-destructive" : ""}`}
                />
                {fieldErrors.email && (
                  <p id="privacy-email-error" role="alert" className="mt-2 text-sm text-destructive">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="privacy-request-type"
                  className="font-heading text-sm font-bold uppercase tracking-[0.1em]"
                >
                  Request type
                </label>

                <select
                  id="privacy-request-type"
                  name="requestType"
                  required
                  defaultValue=""
                  aria-invalid={Boolean(fieldErrors.requestType)}
                  aria-describedby={fieldErrors.requestType ? "privacy-request-type-error" : undefined}
                  onChange={(event) => clearCorrectedError("requestType", event.target.value)}
                  className={`${inputClass} ${fieldErrors.requestType ? "border-destructive focus:border-destructive focus:ring-destructive" : ""}`}
                >
                  <option value="" disabled>
                    Select a request type
                  </option>

                  {requestTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
                {fieldErrors.requestType && (
                  <p id="privacy-request-type-error" role="alert" className="mt-2 text-sm text-destructive">
                    {fieldErrors.requestType}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="privacy-details"
                  className="font-heading text-sm font-bold uppercase tracking-[0.1em]"
                >
                  Details{" "}
                  <span className="text-muted-foreground">
                    (optional)
                  </span>
                </label>

                <textarea
                  id="privacy-details"
                  name="details"
                  rows={6}
                  maxLength={2000}
                  aria-invalid={Boolean(fieldErrors.details)}
                  aria-describedby={fieldErrors.details ? "privacy-details-error" : undefined}
                  onChange={(event) => clearCorrectedError("details", event.target.value)}
                  className={`${inputClass} ${fieldErrors.details ? "border-destructive focus:border-destructive focus:ring-destructive" : ""}`}
                />
                {fieldErrors.details && (
                  <p id="privacy-details-error" role="alert" className="mt-2 text-sm text-destructive">
                    {fieldErrors.details}
                  </p>
                )}
              </div>

              <div className="sr-only" aria-hidden="true">
                <label htmlFor="privacy-website">
                  Website
                </label>

                <input
                  id="privacy-website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                />
              </div>

              <div>
                <button
                  type="submit"
                  disabled={state === "sending"}
                  className={homepagePrimaryButtonClass}
                >
                  {state === "sending"
                    ? "Sending..."
                    : "Send privacy request"}

                  <span aria-hidden="true" className="ml-2">
                    &rarr;
                  </span>
                </button>

                {state === "error" && (
                  <p
                    role="alert"
                    className="mt-4 text-sm text-destructive"
                  >
                    {errorMessage} You can also contact{" "}
                    <a href="mailto:hello@dadhealth.co.uk">
                      hello@dadhealth.co.uk
                    </a>
                    .
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
