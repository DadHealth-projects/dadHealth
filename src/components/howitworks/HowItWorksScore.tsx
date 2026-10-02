const pillars = [
  { label: "Mind", value: "68", trend: "↑" },
  { label: "Body", value: "81", trend: "↑" },
  { label: "Bond", value: "64", trend: "↓", highlighted: true },
];

export default function HowItWorksScore() {
  return (
    <section className="bg-background text-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)] lg:items-center lg:gap-10 lg:px-8 lg:py-16 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)] xl:gap-14 xl:py-20 min-[1440px]:grid-cols-[minmax(0,1fr)_minmax(24rem,0.9fr)] min-[1440px]:gap-20 min-[1440px]:py-24">
        <div>
          <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary">
            The Dad Health Score
          </p>
          <h2 className="mt-5 max-w-2xl font-heading text-5xl font-extrabold uppercase leading-[0.9] tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">
            How you are<br />actually living.
          </h2>
          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Your score is a number out of 100 built from your Mind, Body and Bond pillars. It reflects your real life, not how much you use the app, so a CrossFit session, a bedtime routine and a call to a friend all count.
          </p>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Each pillar shows a week-on-week arrow. The lowest one is flagged, and that is where your one focus for today comes from.
          </p>
        </div>

        <div
          role="img"
          aria-label="Illustrative Dad Health Score of 72, with Mind 68 rising, Body 81 rising, Bond 64 falling, and Bond highlighted"
          className="rounded-3xl border border-border bg-card p-5 shadow-[0_0_24px_hsl(var(--primary)/0.06)] sm:p-8 lg:p-6 xl:p-7 min-[1440px]:p-8"
        >
          <div className="flex items-center gap-4 sm:gap-7">
            <div className="relative size-24 shrink-0 sm:size-32">
              <svg viewBox="0 0 104 104" aria-hidden="true" className="size-full -rotate-90">
                <circle cx="52" cy="52" r="44" fill="none" stroke="currentColor" strokeWidth="10" className="text-border" />
                <circle cx="52" cy="52" r="44" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeDasharray="199 277" className="text-primary" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <p className="font-heading text-4xl font-extrabold leading-none sm:text-5xl">72</p>
                <p className="mt-1 text-[8px] uppercase tracking-[0.18em] text-muted-foreground sm:text-[10px]">Dad score</p>
              </div>
            </div>

            <div className="w-full flex-1">
              {pillars.map((pillar) => (
                <div
                  key={pillar.label}
                  className={`flex min-h-10 items-center justify-between rounded-lg px-2 font-heading text-base font-extrabold uppercase sm:min-h-11 sm:text-xl ${pillar.highlighted ? "bg-primary text-primary-foreground" : "text-foreground"}`}
                >
                  <span>{pillar.label}</span>
                  <span>
                    {pillar.value} <span className={pillar.highlighted ? "text-primary-foreground" : "text-primary"}>{pillar.trend}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 border-t border-border pt-5 sm:mt-8 sm:pt-6">
            <p className="font-heading text-xs font-extrabold uppercase tracking-[0.24em] text-primary">Your one focus</p>
            <p className="mt-2 font-heading text-xl font-extrabold uppercase leading-tight sm:text-2xl">
              60 minutes. Phone down. Just you and them.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
