export default function SupportContactCards() {
  return (
    <section className="bg-background text-foreground">
      <div className="mx-auto grid max-w-7xl gap-5 px-5 py-16 sm:px-6 sm:py-20 lg:grid-cols-3 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <article className="rounded-2xl border border-border bg-card p-6 shadow-[0_0_20px_hsl(var(--primary)/0.04)] sm:p-8">
          <p className="font-heading text-xs font-bold uppercase tracking-[0.25em] text-primary">Email us</p>
          <a href="mailto:hello@dadhealth.co.uk" className="mt-4 block break-words font-heading text-2xl font-extrabold uppercase leading-none transition-colors hover:text-primary sm:text-3xl">
            hello@dadhealth.co.uk
          </a>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Pending: typical response time to be confirmed by Jamie.</p>
        </article>

        <article className="rounded-2xl border border-border bg-card p-6 shadow-[0_0_20px_hsl(var(--primary)/0.04)] sm:p-8">
          <p className="font-heading text-xs font-bold uppercase tracking-[0.25em] text-primary">Bug or feedback</p>
          <h2 className="mt-4 font-heading text-3xl font-extrabold uppercase leading-none sm:text-4xl">Tell us what happened</h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Include your phone model and a screen recording if you can.
          </p>
        </article>

        <article className="rounded-2xl border border-primary bg-primary p-6 text-primary-foreground shadow-[0_0_24px_hsl(var(--primary)/0.12)] sm:p-8">
          <p className="font-heading text-xs font-bold uppercase tracking-[0.25em]">Struggling right now?</p>
          <h2 className="mt-4 font-heading text-3xl font-extrabold uppercase leading-none sm:text-4xl">Samaritans 116 123</h2>
          <p className="mt-4 text-sm leading-relaxed sm:text-base">
            Free, any time. In an emergency, call 999.
          </p>
        </article>
      </div>
    </section>
  );
}
