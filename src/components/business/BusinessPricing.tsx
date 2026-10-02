const plans = [
  {
    size: "From 25 eligible sign-ups",
    title: "Team",
    intro: "Dad Health Pro as a staff benefit.",
    features: [
      "Pro access for every dad on your team",
      "Company code for easy sign-up",
      "Anonymous team dashboard",
      "Onboarding support and launch materials",
    ],
    featured: false,
  },
  {
    size: "From 100 eligible sign-ups",
    title: "Branded",
    intro: "Your own skin of Dad Health.",
    features: [
      "Everything in Team",
      "Your logo and colours throughout the app",
      "Branded welcome screen and your own web address",
      "Dedicated account contact",
    ],
    featured: true,
  },
];

export default function BusinessPricing() {
  return (
    <section id="pricing" className="border-t border-border bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <h2 className="font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">Pricing</h2>
        <p className="mt-5 max-w-4xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Priced per employee, tailored to your organisation. All plans run for a minimum of 12 months.
        </p>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {plans.map((plan) => (
            <article key={plan.title} className={`flex flex-col border bg-card p-6 sm:p-8 ${plan.featured ? "border-primary" : "border-border"}`}>
              <p className="font-heading text-xl font-extrabold text-primary">{plan.size}</p>
              <h3 className="mt-2 font-heading text-4xl font-extrabold uppercase leading-none">{plan.title}</h3>
              <p className="mt-3 text-sm text-muted-foreground sm:text-base">{plan.intro}</p>
              <p className="mt-6 font-heading text-3xl font-extrabold uppercase leading-none">Price on application</p>
              <ul className="my-7 grid gap-3 text-sm text-muted-foreground sm:text-base">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2"><span className="text-primary">+</span><span>{feature}</span></li>
                ))}
              </ul>
              <a
                href="/business/contact"
                className={`mt-auto inline-flex min-h-12 items-center justify-center border-2 px-6 font-heading text-lg font-extrabold uppercase tracking-[0.06em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  plan.featured
                    ? "border-primary bg-primary text-primary-foreground hover:opacity-90"
                    : "border-border hover:border-primary hover:text-primary"
                }`}
              >
                Get a quote
              </a>
            </article>
          ))}
        </div>

        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          Minimum 12-month contract on every plan. Branded plans require a minimum of 100 eligible sign-ups, meaning the number of employees you make Dad Health available to.
        </p>
      </div>
    </section>
  );
}
