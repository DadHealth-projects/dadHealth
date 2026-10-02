const pillars = [
  {
    title: "Mind",
    copy: "A 1-minute daily check-in, a breathing reset when you need it, and a journal that stays yours.",
  },
  {
    title: "Body",
    copy: "Workouts built around your day, a meal planner, and credit for whatever training you already do.",
  },
  {
    title: "Bond",
    copy: "Present Dad Mode, Dad Days out, cooking together. The time with your kids counts.",
  },
];

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

function PillarsSection() {
  return (
    <section id="how" className="scroll-mt-14 bg-primary text-primary-foreground">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end lg:gap-10 xl:grid-cols-[minmax(0,1fr)_22rem] xl:gap-14 min-[1440px]:grid-cols-[minmax(0,1fr)_25rem] min-[1440px]:gap-20">
          <h2 className="font-heading text-5xl font-extrabold uppercase leading-[0.9] tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.5rem] min-[1440px]:text-7xl">
            Three pillars.<br />One score.
          </h2>
          <p className="max-w-xl text-sm leading-relaxed sm:text-base">
            The Dad Health Score reflects how you are actually living, not how much you use the app. Log any workout, any time with the kids, any conversation that helped.
          </p>
        </div>

        <div className="mt-9 grid border-primary-foreground sm:mt-12 lg:grid-cols-3 lg:border-t-2">
          {pillars.map((pillar, index) => (
            <article
              key={pillar.title}
              className={`border-t-2 border-primary-foreground py-5 lg:border-t-0 lg:px-7 lg:py-8 ${index === 0 ? "lg:pl-0" : "lg:border-l-2"}`}
            >
              <h3 className="font-heading text-3xl font-extrabold uppercase leading-none sm:text-4xl">{pillar.title}</h3>
              <p className="mt-3 max-w-sm text-sm leading-relaxed">{pillar.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function StepsSection() {
  return (
    <section className="bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-muted-foreground">
          Every day, three steps
        </p>

        <div className="mt-10 grid gap-9 lg:grid-cols-3 lg:gap-8 xl:gap-12 min-[1440px]:gap-16">
          {steps.map((step) => (
            <article key={step.number} className="grid grid-cols-[3.5rem_1fr] gap-3 lg:block">
              <p className="font-heading text-5xl font-extrabold leading-none text-primary lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">{step.number}</p>
              <div>
                <h3 className="font-heading text-2xl font-extrabold uppercase leading-none sm:text-3xl">{step.title}</h3>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">{step.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function HomepageHowItWorks() {
  return (
    <>
      <PillarsSection />
      <StepsSection />
    </>
  );
}
