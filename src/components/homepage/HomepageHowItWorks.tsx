import Image from "next/image";
import Link from "next/link";

const pillars = [
  { title: "Mind", copy: "A 1-minute daily check-in", image: "/Dad_Health_Web_Graphics/icon-mind.png" },
  { title: "Body", copy: "Any workout counts", image: "/Dad_Health_Web_Graphics/icon-body.png" },
  { title: "Bond", copy: "Time with your kids counts", image: "/Dad_Health_Web_Graphics/icon-bond.png" },
];

const steps = [
  { number: "01", title: "Check in" },
  { number: "02", title: "See your score" },
  { number: "03", title: "Do one thing" },
];

export default function HomepageHowItWorks() {
  return (
    <section id="how" className="scroll-mt-14 bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-6 sm:py-16 lg:px-8 lg:py-16 min-[1440px]:py-20">
        <div>
          <h2 className="font-heading text-5xl font-extrabold uppercase leading-[0.9] tracking-[-0.025em] sm:text-6xl lg:text-5xl min-[1440px]:text-6xl">
            Three pillars.<br />One score.
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground sm:text-base">
            The Dad Health Score reflects how you are actually living, not how much you use the app.
          </p>
        </div>

        <div className="mt-8 grid overflow-hidden rounded-2xl border border-border bg-card shadow-[0_0_20px_hsl(var(--primary)/0.05)] sm:grid-cols-3 lg:mt-9">
          {pillars.map((pillar, index) => (
            <article
              key={pillar.title}
              className={`flex items-center gap-4 p-4 sm:flex-col sm:justify-center sm:px-5 sm:py-6 sm:text-center lg:py-7 ${index > 0 ? "border-t border-border sm:border-l sm:border-t-0" : ""}`}
            >
              <Image src={pillar.image} alt="" width={1200} height={1200} className="size-16 shrink-0 object-cover sm:size-20" />
              <div className="min-w-0 sm:mt-1">
                <h3 className="font-heading text-2xl font-extrabold uppercase leading-none lg:text-3xl">{pillar.title}</h3>
                <p className="mt-1.5 text-sm leading-snug text-muted-foreground">{pillar.copy}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-9 border-t border-border pt-7 sm:mt-10 sm:pt-8">
          <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-muted-foreground">Every day, three steps</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3 sm:gap-4 lg:gap-8">
            {steps.map((step) => (
              <article key={step.number} className="flex items-center gap-3 sm:block">
                <p className="font-heading text-3xl font-extrabold leading-none text-primary sm:text-4xl lg:text-5xl">{step.number}</p>
                <h3 className="font-heading text-xl font-extrabold uppercase leading-none sm:mt-2 sm:text-2xl">{step.title}</h3>
              </article>
            ))}
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Check in → understand where you are → do one useful thing → get back to real life.
            </p>
            <Link href="/howitworks" className="inline-flex min-h-11 shrink-0 items-center rounded-md font-heading text-xs font-extrabold uppercase tracking-[0.08em] text-primary transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-sm sm:tracking-[0.1em]">
              See how it works <span aria-hidden="true" className="ml-2">→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
