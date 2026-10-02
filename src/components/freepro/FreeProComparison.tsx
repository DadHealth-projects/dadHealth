const features = [
  {
    feature: "Dad Health Score",
    free: "Score and current pillar trends",
    pro: "Everything in Free, plus deeper history and insights",
  },
  { feature: "Daily check-in", free: "Yes", pro: "Yes" },
  { feature: "Breathing, Journal and crisis support", free: "Yes", pro: "Yes" },
  { feature: "Basic workouts", free: "Yes", pro: "Yes" },
  { feature: "Personalised Body functionality and AI workouts", free: "—", pro: "Yes" },
  { feature: "Meal Planner", free: "—", pro: "Yes" },
  { feature: "Manual Mind, Body and Bond logging", free: "Yes", pro: "Yes" },
  { feature: "Dad Days", free: "3 searches per month", pro: "Unlimited" },
  { feature: "Community", free: "Full access", pro: "Full access" },
  { feature: "Reports", free: "—", pro: "Weekly and monthly reports" },
  { feature: "Streak protection", free: "—", pro: "One freeze per week" },
];

export default function FreeProComparison() {
  return (
    <section className="bg-card text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <h2 className="font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">
          Side by side
        </h2>

        <div className="mt-10">
          <div className="hidden grid-cols-[1.3fr_1fr_1fr] border-b-2 border-foreground pb-4 font-heading text-sm font-extrabold uppercase tracking-[0.12em] md:grid">
            <span>Feature</span>
            <span className="text-center">Free</span>
            <span className="text-center text-primary">Pro</span>
          </div>

          {features.map((item) => (
            <div
              key={item.feature}
              className="grid gap-4 border-b border-border py-5 md:grid-cols-[1.3fr_1fr_1fr] md:gap-6"
            >
              <h3 className="text-sm font-medium">{item.feature}</h3>
              <div className="grid grid-cols-2 gap-4 md:contents">
                <p className="text-sm leading-relaxed text-muted-foreground md:text-center">
                  <span className="mb-1 block font-heading text-xs font-extrabold uppercase tracking-[0.12em] text-foreground md:hidden">Free</span>
                  {item.free}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground md:text-center">
                  <span className="mb-1 block font-heading text-xs font-extrabold uppercase tracking-[0.12em] text-primary md:hidden">Pro</span>
                  {item.pro}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
