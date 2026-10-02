const employerInsights = [
  "Team-level averages for Mind, Body and Bond",
  "Seats used and engagement over time",
  "Month-by-month trends you can share with HR and leadership",
  "Nothing is shown until a group is large enough that no one can be identified",
];

const privateDetails = [
  "Check-ins, mood or journal entries",
  "Scores or activity logs",
  "Name against any result",
];

export default function BusinessPrivacy() {
  return (
    <section id="privacy" className="border-t border-border bg-background text-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-8 xl:gap-12 min-[1440px]:gap-16 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <div>
          <h2 className="max-w-xl font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">
            Real insight. Zero snooping.
          </h2>
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Dads only use a tool like this if they trust it. So your team&apos;s data stays theirs, and you get the picture without the detail.
          </p>
          <ul className="mt-8 grid gap-4">
            {employerInsights.map((insight) => (
              <li key={insight} className="flex gap-3 text-sm leading-relaxed sm:text-base">
                <span aria-hidden="true" className="font-bold text-primary">✓</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="self-start border border-border bg-card p-6 sm:p-8">
          <h3 className="font-heading text-3xl font-extrabold uppercase leading-none text-primary sm:text-4xl">
            What you never see
          </h3>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-base">
            An employer cannot see any individual dad&apos;s:
          </p>
          <ul className="mt-5 grid gap-3 border-t border-border pt-5">
            {privateDetails.map((detail) => (
              <li key={detail} className="flex gap-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                <span aria-hidden="true" className="text-destructive">×</span>
                <span>{detail}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 border-t border-border pt-5 text-sm leading-relaxed sm:text-base">
            Dads are told this in the app when they join with their company code.
          </p>
        </div>
      </div>
    </section>
  );
}
