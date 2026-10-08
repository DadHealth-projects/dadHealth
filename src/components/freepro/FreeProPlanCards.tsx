import {
  marketingCardSurfaceClass,
  marketingContainerClass,
} from "@/components/marketing/marketingStyles";

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
    <ul className={`mt-7 space-y-4 text-[15px] sm:text-base ${muted ? "text-muted-foreground" : "text-primary-foreground"}`}>
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
      <div className={`${marketingContainerClass} grid gap-4 py-14 sm:py-16 lg:grid-cols-2 lg:py-16 min-[1440px]:py-20`}>
        <article className={`${marketingCardSurfaceClass} p-5 sm:p-7`}>
          <h2 className="font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">Free</h2>
          <p className="mt-4 font-heading text-xl font-extrabold">£0, forever</p>
          <FeatureList features={freeFeatures} muted />
        </article>

        <article className="rounded-2xl border border-primary bg-primary p-5 text-primary-foreground shadow-[0_0_24px_hsl(var(--primary)/0.12)] sm:p-7">
          <h2 className="font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">Pro</h2>
          <p className="mt-4 font-heading text-xl font-extrabold">£6.99/month or £49.99/year</p>
          <FeatureList features={proFeatures} />
        </article>
      </div>
    </section>
  );
}
