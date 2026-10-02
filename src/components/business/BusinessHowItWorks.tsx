const steps = [
  {
    title: "We talk",
    copy: "A short call to understand your team and pick the right plan.",
  },
  {
    title: "We set you up",
    copy: "Your company code, your dashboard and, on the branded plan, your look and feel.",
  },
  {
    title: "Dads join",
    copy: "They download the app, enter your code and get Pro. Already a Dad Health member? Their existing account is added to your company's membership using the email they already use.",
  },
  {
    title: "You see the picture",
    copy: "Anonymous team insights, updated as your dads use the app.",
  },
];

export default function BusinessHowItWorks() {
  return (
    <section id="how" className="border-t border-border bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <h2 className="font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">
          How it works
        </h2>
        <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          {steps.map((step, index) => (
            <li key={step.title} className="border-t-4 border-primary pt-4">
              <p className="font-heading text-4xl font-extrabold leading-none text-primary">{index + 1}</p>
              <h3 className="mt-2 font-heading text-2xl font-extrabold uppercase leading-none">{step.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{step.copy}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
