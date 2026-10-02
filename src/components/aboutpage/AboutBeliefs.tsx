const beliefs = [
  { title: "Built for dads", copy: "Not a generic wellbeing app. Everything is designed around how dads actually live." },
  { title: "Free is the real thing", copy: "The score, check-in and support are free. Pro makes it personal." },
  { title: "Your data is yours", copy: "Your journal and check-ins stay yours. Always." },
];

export default function AboutBeliefs() {
  return (
    <section className="bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-muted-foreground sm:text-sm">What we believe</p>
        <div className="mt-10 grid gap-10 lg:grid-cols-3 lg:gap-12">
          {beliefs.map((belief) => (
            <article key={belief.title} className="border-t-4 border-primary pt-5">
              <h2 className="font-heading text-2xl font-extrabold uppercase leading-none sm:text-3xl">{belief.title}</h2>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground sm:text-base">{belief.copy}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
