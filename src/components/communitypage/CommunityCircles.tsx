const circles = [
  {
    title: "New Dad Crew",
    intro: "Early years dads. Newborn to toddler stage.",
    description: "Sleep, first steps, the wobbly bits nobody warned you about.",
  },
  {
    title: "Single Dads",
    intro: "Solo parenting and co-parenting.",
    description: "Handovers, routines and doing it on your own terms.",
  },
  {
    title: "Dad Strength",
    intro: "Fitness and performance.",
    description: "Training, recovery and staying strong for the people who need you.",
  },
  {
    title: "Every Kind of Dad",
    intro: "Stepdads, grandads, adoptive dads and every dad figure.",
    description: "If you are a dad figure in a child’s life, you belong here.",
  },
];

export default function CommunityCircles() {
  return (
    <section className="bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <h2 className="font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">
          Four Circles
        </h2>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {circles.map((circle) => (
            <article key={circle.title} className="rounded-2xl border border-border border-t-4 border-t-primary bg-card p-6 shadow-[0_0_20px_hsl(var(--primary)/0.04)] sm:p-8 lg:p-10">
              <h3 className="font-heading text-3xl font-extrabold uppercase leading-none sm:text-4xl">
                {circle.title}
              </h3>
              <p className="mt-4 text-sm leading-relaxed sm:text-base">{circle.intro}</p>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                {circle.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
