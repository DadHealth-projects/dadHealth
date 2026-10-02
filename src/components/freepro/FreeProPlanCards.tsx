const freeFeatures = [
  "Dad Health Score",
  "Current score and pillar trends",
  "Daily check-in",
  "Breathing, Journal and crisis support",
  "Basic workouts",
  "Manual Mind, Body and Bond logging",
  "Community",
  "Dad Days: 3 searches per month",
];

const proFeatures = [
  "Everything in Free",
  "Deeper score and history insights",
  "Personalised Body functionality and AI workouts",
  "Meal Planner",
  "Unlimited Dad Days",
  "Weekly and monthly reports",
  "One streak freeze per week",
];

function FeatureList({ features, muted = false }: { features: string[]; muted?: boolean }) {
  return (
    <ul className={`mt-7 space-y-4 text-sm sm:text-base ${muted ? "text-muted-foreground" : "text-primary-foreground"}`}>
      {features.map((feature) => (
        <li key={feature} className="flex gap-3 leading-relaxed">
          <span aria-hidden="true" className={`mt-2 size-2 shrink-0 ${muted ? "bg-primary" : "bg-primary-foreground"}`} />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}

export default function FreeProPlanCards() {
  return (
    <section className="bg-background text-foreground">
      <div className="mx-auto grid max-w-7xl gap-4 px-5 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <article className="border border-border p-6 sm:p-9 lg:p-11">
          <h2 className="font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">Free</h2>
          <p className="mt-4 font-heading text-xl font-extrabold">£0, forever</p>
          <FeatureList features={freeFeatures} muted />
        </article>

        <article className="bg-primary p-6 text-primary-foreground sm:p-9 lg:p-11">
          <h2 className="font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">Pro</h2>
          <p className="mt-4 font-heading text-xl font-extrabold">£49.99/year</p>
          <FeatureList features={proFeatures} />
        </article>
      </div>
    </section>
  );
}
