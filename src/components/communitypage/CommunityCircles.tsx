import {
  marketingBodyClass,
  marketingCardSurfaceClass,
  marketingSectionClass,
  marketingSectionHeadingClass,
} from "@/components/marketing/marketingStyles";

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
      <div className={marketingSectionClass}>
        <h2 className={marketingSectionHeadingClass}>
          Four Circles
        </h2>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {circles.map((circle) => (
            <article key={circle.title} className={`${marketingCardSurfaceClass} border-t-4 border-t-primary p-5 sm:p-7`}>
              <h3 className="font-heading text-3xl font-extrabold uppercase leading-none sm:text-4xl">
                {circle.title}
              </h3>
              <p className="mt-4 text-[15px] leading-relaxed sm:text-base">{circle.intro}</p>
              <p className={`mt-3 ${marketingBodyClass}`}>
                {circle.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
