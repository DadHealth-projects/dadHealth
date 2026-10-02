import Link from "next/link";

export default function AboutCompanyContact() {
  return (
    <section className="bg-background text-foreground">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-8 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <div>
          <h2 className="font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">The company</h2>
          <address className="mt-5 text-sm not-italic leading-relaxed text-muted-foreground sm:text-base">
            Dad Health Ltd &middot; Company No. 17407334<br />66 Paul Street, London EC2A 4NA
          </address>
        </div>
        <div className="lg:justify-self-end">
          <h2 className="font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">Get in touch</h2>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Questions, press or partnerships:{" "}
            <a className="text-foreground underline decoration-primary underline-offset-4" href="mailto:hello@dadhealth.co.uk">hello@dadhealth.co.uk</a>
          </p>
          <Link href="/support" className="mt-6 inline-flex min-h-11 items-center rounded-xl border border-primary/40 bg-card px-4 font-heading text-sm font-extrabold uppercase tracking-[0.12em] text-primary shadow-[0_0_16px_hsl(var(--primary)/0.04)] transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            Visit support <span aria-hidden="true" className="ml-2">&rarr;</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
