const circles = [
  { title: "New Dad Crew", copy: "Newborn to toddler years" },
  { title: "Single Dads", copy: "Solo parenting and co-parenting" },
  { title: "Dad Strength", copy: "Fitness and performance" },
  { title: "Every Kind of Dad", copy: "Stepdads, grandads, adoptive dads and every dad figure" },
];

export default function HomepageCircles() {
  return (
    <section id="community" className="scroll-mt-14 bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">Dad Circles</h2>
          <p className="max-w-md text-sm text-muted-foreground">Find dads going through the same chapter as you.</p>
        </div>

        <div className="mt-9 grid grid-cols-2 gap-x-4 gap-y-7 lg:grid-cols-4 lg:gap-6">
          {circles.map((circle) => (
            <article key={circle.title} className="border-t-2 border-primary pt-4">
              <h3 className="font-heading text-xl font-extrabold uppercase leading-none sm:text-2xl">{circle.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">{circle.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
