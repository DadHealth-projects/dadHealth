import { marketingBodyClass, marketingSectionClass } from "@/components/marketing/marketingStyles";

const pillars = [
  {
    title: "Mind",
    features: [
      "1-minute daily check-in",
      "Breathing reset and 4-4-4 breathing",
      "Journal",
      "Crisis support",
      "Manual Mind logging",
    ],
  },
  {
    title: "Body",
    features: [
      "Workouts built around your day",
      "Meal Planner",
      "TDEE calculator",
      "Manual workout logging",
      "Progress that reflects real training",
    ],
  },
  {
    title: "Bond",
    features: [
      "Present Dad Mode",
      "Dad Days",
      "Cook Together",
      "Manual quality-time logging",
    ],
  },
];

export default function HowItWorksPillars() {
  return (
    <section className="bg-card text-foreground">
      <div className={marketingSectionClass}>
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-muted-foreground">
          What sits behind each pillar
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-3 lg:gap-10">
          {pillars.map((pillar) => (
            <article key={pillar.title} className="border-t-2 border-primary pt-5">
              <h2 className="font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">
                {pillar.title}
              </h2>
              <ul className="mt-6 space-y-4">
                {pillar.features.map((feature) => (
                  <li key={feature} className={`flex gap-3 ${marketingBodyClass}`}>
                    <span aria-hidden="true" className="mt-2 size-2 shrink-0 bg-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
