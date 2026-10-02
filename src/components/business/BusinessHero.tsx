type DashboardPillar = {
  label: "Mind" | "Body" | "Bond";
  score: number;
  direction: "↑" | "↓";
};

const dashboardScore = 71;

const pillars: DashboardPillar[] = [
  { label: "Mind", score: 68, direction: "↑" },
  { label: "Body", score: 74, direction: "↑" },
  { label: "Bond", score: 72, direction: "↓" },
];

function EmployerDashboard() {
  return (
    <div
      role="img"
      aria-label="Example employer dashboard showing anonymous team scores"
      className="border border-border border-r-4 border-r-primary bg-card p-5 shadow-[8px_8px_0_0_hsl(var(--primary))] sm:p-7 lg:p-5 xl:p-6 min-[1440px]:p-7"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-heading text-xl font-extrabold uppercase tracking-[0.04em]">Acme Logistics</p>
          <p className="text-xs text-muted-foreground">Team overview, anonymised</p>
        </div>
        <span className="whitespace-nowrap border border-border px-2 py-1 text-[10px] text-muted-foreground">Example data</span>
      </div>

      <div className="mt-6 grid items-center gap-6 sm:grid-cols-[8rem_1fr] lg:gap-4 xl:gap-5 min-[1440px]:gap-6">
        <div className="relative mx-auto grid size-28 place-items-center sm:size-32 lg:size-28 xl:size-30 min-[1440px]:size-32">
          <svg viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90 text-primary" aria-hidden="true">
            <circle className="text-muted" cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              pathLength="100"
              strokeDasharray={`${dashboardScore} ${100 - dashboardScore}`}
              strokeLinecap="round"
            />
          </svg>
          <div className="relative text-center">
            <strong className="block font-heading text-5xl font-extrabold leading-none">{dashboardScore}</strong>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">avg score</span>
          </div>
        </div>

        <div className="grid gap-4">
          {pillars.map((pillar) => (
            <div key={pillar.label}>
              <div className="mb-1 flex justify-between text-xs">
                <span>{pillar.label}</span>
                <span className={pillar.direction === "↑" ? "text-primary" : "text-destructive"}>
                  {pillar.score} {pillar.direction}
                </span>
              </div>
              <svg
                viewBox="0 0 100 4"
                preserveAspectRatio="none"
                role="img"
                aria-label={`${pillar.label} score ${pillar.score} out of 100`}
                className="block h-2 w-full text-primary"
              >
                <line className="text-muted" x1="0" y1="2" x2="100" y2="2" stroke="currentColor" strokeWidth="4" />
                <line
                  x1="0"
                  y1="2"
                  x2="100"
                  y2="2"
                  stroke="currentColor"
                  strokeWidth="4"
                  pathLength="100"
                  strokeDasharray={`${pillar.score} ${100 - pillar.score}`}
                />
              </svg>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5 text-xs text-muted-foreground">
        <p><strong className="block font-heading text-2xl font-extrabold text-foreground">62 of 100</strong>seats active</p>
        <p><strong className="block font-heading text-2xl font-extrabold text-foreground">+4</strong>average score this month</p>
      </div>
    </div>
  );
}

export default function BusinessHero() {
  return (
    <section className="bg-background text-foreground">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-6 sm:py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-8 xl:gap-12 min-[1440px]:gap-16 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <div>
          <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">Dad Health for Business</p>
          <h1 className="mt-6 max-w-3xl font-heading text-[3.6rem] font-extrabold uppercase leading-[0.84] tracking-[-0.035em] sm:text-7xl lg:text-[4.5rem] xl:text-[5rem] min-[1440px]:text-[5.5rem] 2xl:text-[6.5rem]">
            Look after the dads on <span className="text-primary">your team.</span>
          </h1>
          <p className="mt-7 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Dad Health is the mental health, fitness and parenting app built for fathers. Give your working dads full Pro access as a staff benefit, and see how the team is doing without ever seeing who is who.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/business/contact" className="inline-flex min-h-12 items-center justify-center bg-primary px-6 font-heading text-lg font-extrabold uppercase tracking-[0.06em] text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Book a call</a>
            <a href="/howitworks" className="inline-flex min-h-12 items-center justify-center border-2 border-border px-6 font-heading text-lg font-extrabold uppercase tracking-[0.06em] transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">See how it works</a>
          </div>
        </div>
        <EmployerDashboard />
      </div>
    </section>
  );
}
