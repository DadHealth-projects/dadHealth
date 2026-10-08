import Link from "next/link";

const circles = [
  { number: "01", title: "New Dad Crew", copy: "Newborn to toddler years" },
  { number: "02", title: "Single Dads", copy: "Solo parenting and co-parenting" },
  { number: "03", title: "Dad Strength", copy: "Fitness and performance" },
  { number: "04", title: "Every Kind of Dad", copy: "Stepdads, grandads, adoptive dads and every dad figure" },
];

export default function HomepageCircles() {
  return (
    <section id="community" className="scroll-mt-14 bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-16 min-[1440px]:py-20">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl lg:text-5xl min-[1440px]:text-6xl">Dad Circles</h2>
            <p className="mt-3 max-w-md text-[15px] text-muted-foreground sm:text-base">Find dads going through the same chapter as you.</p>
          </div>
          <Link href="/dad-circles" className="inline-flex min-h-11 items-center rounded-md font-heading text-xs font-extrabold uppercase tracking-[0.08em] text-primary transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-sm sm:tracking-[0.1em]">
            Explore Dad Circles <span aria-hidden="true" className="ml-2">→</span>
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {circles.map((circle) => (
            <Link key={circle.title} href="/dad-circles" aria-label={`Learn about ${circle.title}`} className="relative flex min-h-[9.5rem] flex-col overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-[0_0_18px_hsl(var(--primary)/0.04)] transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-44 sm:p-5">
              <span aria-hidden="true" className="absolute left-4 right-12 top-3 h-px bg-foreground/70 sm:left-5" />
              <span aria-hidden="true" className="absolute bottom-5 right-3 top-12 w-px bg-foreground/70" />
              <span aria-hidden="true" className="absolute bottom-3 left-14 right-3 h-px bg-foreground/70 sm:left-16" />
              <span className="relative font-heading text-xl font-extrabold leading-none text-primary sm:text-2xl">{circle.number}</span>
              <div className="relative mt-6 flex flex-col pr-2 pb-2 sm:mt-7 sm:pb-3">
                <h3 className="font-heading text-xl font-extrabold uppercase leading-[0.9] sm:text-3xl lg:text-2xl min-[1440px]:text-3xl">{circle.title}</h3>
                <p className="mt-2 text-xs leading-snug text-foreground/75 sm:text-muted-foreground">{circle.copy}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
