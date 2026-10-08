import {
  marketingBodyClass,
  marketingSectionClass,
  marketingSectionHeadingClass,
} from "@/components/marketing/marketingStyles";

const steps = [
  {
    title: "We get in touch",
    copy: "Your company lets us know when a dad leaves. We contact him, explain his options in plain English and talk about staying on.",
  },
  {
    title: "We walk him through it",
    copy: "A few simple screens move him to a personal account. His score, streak and history come with him.",
  },
  {
    title: "He carries on",
    copy: "He continues on his own subscription. If he'd rather not, he keeps a free account.",
  },
];

export default function BusinessLeavers() {
  return (
    <section id="leavers" className="border-t border-border bg-card text-foreground">
      <div className={marketingSectionClass}>
        <h2 className={`max-w-5xl ${marketingSectionHeadingClass}`}>
          When a dad moves on, his progress goes with him
        </h2>
        <p className={`mt-5 max-w-5xl ${marketingBodyClass}`}>
          If someone leaves your company, he isn&apos;t left with nothing. He&apos;s offered the chance to move to his own personal Dad Health account and carry on, and we guide him through it in the app.
        </p>

        <ol className="mt-10 grid gap-8 lg:grid-cols-3 lg:gap-8">
          {steps.map((step, index) => (
            <li key={step.title} className="border-t-4 border-primary pt-4">
              <p className="font-heading text-4xl font-extrabold leading-none text-primary">{index + 1}</p>
              <h3 className="mt-2 font-heading text-2xl font-extrabold uppercase leading-none">{step.title}</h3>
              <p className={`mt-3 ${marketingBodyClass}`}>{step.copy}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
