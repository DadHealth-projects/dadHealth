import Link from "next/link";
import {
  marketingBodyClass,
  marketingContainerClass,
} from "@/components/marketing/marketingStyles";

export default function AboutCompanyContact() {
  return (
    <section className="bg-background text-foreground">
      <div
        className={`${marketingContainerClass} grid gap-12 py-14 sm:py-16 lg:grid-cols-2 lg:gap-8 lg:py-16 min-[1440px]:py-20`}
      >
        <div>
          <h2 className="font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">
            The company
          </h2>

          <address className={`mt-5 not-italic ${marketingBodyClass}`}>
            Dad Health Ltd &middot; Company No. 17407334
            <br />
            66 Paul Street, London EC2A 4NA
          </address>
        </div>

        <div className="lg:justify-self-end">
          <h2 className="font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">
            Get in touch
          </h2>

          <p className={`mt-5 ${marketingBodyClass}`}>
            Questions, press or partnerships:{" "}
            <a
              className="text-foreground underline decoration-primary underline-offset-4"
              href="mailto:hello@dadhealth.co.uk"
            >
              hello@dadhealth.co.uk
            </a>
          </p>

          <Link
            href="/support"
            className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-border bg-card px-6 font-heading text-lg font-extrabold uppercase tracking-[0.06em] shadow-[0_0_18px_hsl(var(--primary)/0.04)] transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Visit support
          </Link>
        </div>
      </div>
    </section>
  );
}