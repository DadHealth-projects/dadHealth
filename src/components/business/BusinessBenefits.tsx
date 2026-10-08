import {
  marketingBodyClass,
  marketingSectionClass,
  marketingSectionHeadingClass,
} from "@/components/marketing/marketingStyles";

const benefits = [
  {
    title: "Mind",
    copy: "Breathing resets, guided reflection, daily check-ins and a journal, with support one tap away when a dad needs it.",
  },
  {
    title: "Body",
    copy: "Workouts built around his time and equipment, and any activity he already does can be logged, from CrossFit to a walk.",
  },
  {
    title: "Bond",
    copy: "Ideas for days out, cooking together and Present Dad Mode: sixty minutes, phone down, just him and his kids.",
  },
];

export default function BusinessBenefits() {
  return (
    <section id="what-you-get" className="border-t border-border bg-card text-foreground">
      <div className={marketingSectionClass}>
        <h2 className={marketingSectionHeadingClass}>A benefit dads will actually use</h2>
        <p className={`mt-5 max-w-4xl ${marketingBodyClass}`}>
          Most wellbeing perks are built for everyone, so many men never touch them. Dad Health speaks to fathers directly, in a few minutes a day.
        </p>

        <div className="mt-10 grid gap-8 lg:grid-cols-3 lg:gap-10">
          {benefits.map((benefit) => (
            <article key={benefit.title} className="border-l-4 border-primary pl-5">
              <h3 className="font-heading text-3xl font-extrabold uppercase leading-none">{benefit.title}</h3>
              <p className={`mt-3 ${marketingBodyClass}`}>{benefit.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
