export default function SupportStillStuck() {
  return (
    <section className="bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <h2 className="font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">Still stuck?</h2>
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-base">Email us and we will come back to you.</p>
        <a
          href="mailto:hello@dadhealth.co.uk"
          className="mt-7 inline-flex min-h-12 items-center justify-center bg-primary px-6 font-heading text-lg font-extrabold uppercase tracking-[0.06em] text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Email support <span aria-hidden="true" className="ml-2">&rarr;</span>
        </a>
      </div>
    </section>
  );
}
