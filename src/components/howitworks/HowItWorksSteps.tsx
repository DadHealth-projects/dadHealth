import { marketingBodyClass, marketingSectionClass } from "@/components/marketing/marketingStyles";

const steps = [
  {
    number: "01",
    title: "Check in",
    copy: "Three honest questions. One minute. Your Mind score updates straight away.",
  },
  {
    number: "02",
    title: "See your score",
    copy: "Mind, Body and Bond out of 100, with the one that needs you most flagged.",
  },
  {
    number: "03",
    title: "Do one thing",
    copy: "Not a to-do list. One action for today, then get on with your life.",
  },
];

export default function HowItWorksSteps() {
  return (
    <section className="bg-background text-foreground">
      <div className={marketingSectionClass}>
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-muted-foreground">
          Every day, three steps
        </p>

        <div className="mt-10 grid gap-9 lg:grid-cols-3 lg:gap-8 xl:gap-12 min-[1440px]:gap-16">
          {steps.map((step) => (
            <article key={step.number} className="grid grid-cols-[3.5rem_1fr] gap-3 lg:block">
              <p className="font-heading text-5xl font-extrabold leading-none text-primary lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">
                {step.number}
              </p>
              <div>
                <h2 className="font-heading text-2xl font-extrabold uppercase leading-none sm:text-3xl">
                  {step.title}
                </h2>
                <p className={`mt-3 max-w-sm ${marketingBodyClass}`}>
                  {step.copy}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
