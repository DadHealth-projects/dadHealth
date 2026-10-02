const steps = [
  {
    number: "01",
    title: "Pick your Circle",
    copy: "Choose the chapter that fits where you are right now.",
  },
  {
    number: "02",
    title: "Join the conversation",
    copy: "Answer a prompt, share a win or ask something you have been sitting on.",
  },
  {
    number: "03",
    title: "Get support",
    copy: "Post in your Circle and hear from dads going through the same chapter.",
  },
];

export default function CommunityHowItWorks() {
  return (
    <section className="bg-card text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-muted-foreground">
          How it works
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
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
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
