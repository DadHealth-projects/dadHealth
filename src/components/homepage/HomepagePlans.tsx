import Link from "next/link";

const plans = [
  {
    title: "Free",
    features: ["Dad Health Score", "Daily check-in", "Current pillar trends", "Community access"],
    highlighted: false,
  },
  {
    title: "Pro",
    price: ["£6.99/month", "£49.99/year"],
    outcome: "What is driving your score, how it is trending, and what to do about it.",
    features: ["Deeper score history and insights", "Personalised Body functionality and AI workouts", "Unlimited Dad Days"],
    highlighted: true,
  },
];

export default function HomepagePlans() {
  return (
    <section id="pro" className="scroll-mt-14 border-y border-border bg-background text-foreground">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-14 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] lg:items-center lg:gap-10 lg:px-8 lg:py-16 min-[1440px]:gap-16 min-[1440px]:py-20">
        <div>
          <h2 className="font-heading text-5xl font-extrabold uppercase leading-[0.9] tracking-[-0.025em] sm:text-6xl lg:text-5xl min-[1440px]:text-6xl">Free is the<br />real thing.</h2>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground sm:text-base">Pro makes it personal.</p>
          <Link href="/free-and-pro" className="mt-5 inline-flex min-h-11 items-center rounded-md font-heading text-sm font-extrabold uppercase tracking-[0.1em] text-primary transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            Compare Free &amp; Pro <span aria-hidden="true" className="ml-2">→</span>
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map((plan) => (
            <article key={plan.title} className={`rounded-2xl border p-6 shadow-[0_0_20px_hsl(var(--primary)/0.05)] sm:p-7 ${plan.highlighted ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}>
              <div className="flex items-start justify-between gap-4">
                <h3 className="font-heading text-3xl font-extrabold uppercase">{plan.title}</h3>
                {plan.price && (
                  <p className="text-right font-heading text-sm font-extrabold leading-snug">
                    {plan.price.map((price) => <span key={price} className="block">{price}</span>)}
                  </p>
                )}
              </div>
              {plan.outcome && <p className="mt-4 text-sm leading-relaxed">{plan.outcome}</p>}
              <ul className={`mt-5 space-y-2 text-sm ${plan.highlighted ? "" : "text-muted-foreground"}`}>
                {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
