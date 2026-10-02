const benefits = [
  {
    title: "Mind",
    copy: "Breathing resets, guided reflection, daily check-ins and a journal, with support one tap away when a dad needs it.",
  },
  {
    title: "Body",
    copy: "Workouts built around his time and equipment, and any activity he already does can be logged, from CrossFit to a walk.",
  },
  {
    title: "Bond",
    copy: "Ideas for days out, cooking together and Present Dad Mode: sixty minutes, phone down, just him and his kids.",
  },
];

export default function BusinessBenefits() {
  return (
    <section id="what-you-get" className="border-t border-border bg-card text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <h2 className="font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">A benefit dads will actually use</h2>
        <p className="mt-5 max-w-4xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Most wellbeing perks are built for everyone, so many men never touch them. Dad Health speaks to fathers directly, in a few minutes a day.
        </p>

        <div className="mt-10 grid gap-8 lg:grid-cols-3 lg:gap-10">
          {benefits.map((benefit) => (
            <article key={benefit.title} className="border-l-4 border-primary pl-5">
              <h3 className="font-heading text-3xl font-extrabold uppercase leading-none">{benefit.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{benefit.copy}</p>
            </article>
          ))}
        </div>

        <p className="mt-10 max-w-5xl text-sm leading-relaxed sm:text-base">
          Every dad gets a Dad Health Score across the three pillars, a streak to keep him coming back, and the full Pro experience, paid for by you.
        </p>
      </div>
    </section>
  );
}
