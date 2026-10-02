import Link from "next/link";

export default function HomepageFounder() {
  return (
    <section id="about" className="scroll-mt-14 border-y border-border bg-card text-foreground">
      <div className="mx-auto grid max-w-7xl gap-7 px-5 py-10 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center sm:px-6 sm:py-12 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10 lg:px-8 lg:py-14">
        <div className="flex aspect-[4/3] items-center justify-center rounded-2xl border border-border bg-background px-6 text-center shadow-[0_0_18px_hsl(var(--primary)/0.04)]">
          <p className="font-heading text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Founder photo to come
          </p>
        </div>

        <div className="max-w-2xl">
          <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary">From our founder</p>
          <h2 className="mt-3 font-heading text-3xl font-extrabold uppercase leading-none sm:text-4xl">
            Built by a dad who&apos;s been there
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Five years ago I was obese, drinking most days, and carrying mental health struggles I&apos;d never dealt with. I swore I wouldn&apos;t be a dad who couldn&apos;t keep up with his kid, in body or in mind.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            I got myself together through grit and determination, with nothing built for a dad like me. Dad Health is what I wish I&apos;d had.
          </p>
          <Link
            href="/about"
            className="mt-5 inline-flex min-h-11 items-center rounded-md font-heading text-sm font-extrabold uppercase tracking-[0.1em] text-primary transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Read my story <span aria-hidden="true" className="ml-2">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
