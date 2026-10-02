const freeFeatures = [
  "Dad Health Score",
  "Daily check-in",
  "Breathing, journal and crisis support",
  "Basic workouts",
  "Manual Mind, Body and Bond logging",
  "Community access",
  "Dad Days: 3 searches per month",
  "Current pillar trends",
];

const proFeatures = [
  "Everything in Free",
  "Deeper historical trends and score insights",
  "Personalised Body plans and AI workouts",
  "Unlimited Dad Days",
  "Sunday weekly report",
];

export default function HomepagePlans() {
  return (
    <section id="pro" className="scroll-mt-14 border-y border-border bg-background text-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] lg:items-start lg:gap-8 xl:gap-12 min-[1440px]:gap-16 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <div>
          <h2 className="font-heading text-5xl font-extrabold uppercase leading-[0.9] tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">
            Free is the<br />real thing.
          </h2>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
            Pro makes it personal: what is driving your score, how it is trending, and what to do about it.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <article className="rounded-2xl border border-border bg-card p-6 shadow-[0_0_20px_hsl(var(--primary)/0.04)] sm:p-7">
            <h3 className="font-heading text-3xl font-extrabold uppercase">Free</h3>
            <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
              {freeFeatures.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
          </article>

          <article className="rounded-2xl border border-primary bg-primary p-6 text-primary-foreground shadow-[0_0_24px_hsl(var(--primary)/0.12)] sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <h3 className="font-heading text-3xl font-extrabold uppercase">Pro</h3>
              <p className="font-heading text-lg font-extrabold">£49.99/year</p>
            </div>
            <ul className="mt-5 space-y-2 text-sm">
              {proFeatures.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}
