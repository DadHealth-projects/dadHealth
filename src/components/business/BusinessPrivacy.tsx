import {
  marketingBodyClass,
  marketingCardSurfaceClass,
  marketingContainerClass,
  marketingSectionHeadingClass,
} from "@/components/marketing/marketingStyles";

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
      <div className={`${marketingContainerClass} grid gap-10 py-14 sm:py-16 lg:grid-cols-2 lg:gap-8 lg:py-16 xl:gap-12 min-[1440px]:gap-16 min-[1440px]:py-20`}>
        <div>
          <h2 className={`max-w-xl ${marketingSectionHeadingClass}`}>
            Real insight. Zero snooping.
          </h2>
          <p className={`mt-5 max-w-xl ${marketingBodyClass}`}>
            Dads only use a tool like this if they trust it. So your team&apos;s data stays theirs, and you get the picture without the detail.
          </p>
          <ul className="mt-8 grid gap-4">
            {employerInsights.map((insight) => (
              <li key={insight} className="flex gap-3 text-[15px] leading-relaxed sm:text-base">
                <span aria-hidden="true" className="font-bold text-primary">✓</span>
                <span>{insight}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={`${marketingCardSurfaceClass} self-start p-5 sm:p-7`}>
          <h3 className="font-heading text-3xl font-extrabold uppercase leading-none text-primary sm:text-4xl">
            What you never see
          </h3>
          <p className={`mt-5 ${marketingBodyClass}`}>
            An employer cannot see any individual dad&apos;s:
          </p>
          <ul className="mt-5 grid gap-3 border-t border-border pt-5">
            {privateDetails.map((detail) => (
              <li key={detail} className={`flex gap-3 ${marketingBodyClass}`}>
                <span aria-hidden="true" className="text-destructive">×</span>
                <span>{detail}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 border-t border-border pt-5 text-[15px] leading-relaxed sm:text-base">
            Dads are told this in the app when they join with their company code.
          </p>
        </div>
      </div>
    </section>
  );
}
