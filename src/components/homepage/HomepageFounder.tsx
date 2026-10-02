export default function HomepageFounder() {
  return (
    <section id="about" className="scroll-mt-14 bg-card text-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-10 xl:gap-14 min-[1440px]:gap-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <div className="flex aspect-[4/3] items-center justify-center border border-border bg-background px-8 text-center">
          <p className="font-heading text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Founder photo to come
          </p>
        </div>

        <div>
          <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary">Why Dad Health</p>
          <h2 className="mt-5 font-heading text-5xl font-extrabold uppercase leading-[0.9] tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">
            The advice we wish we&apos;d had sooner.
          </h2>
          <div className="mt-6 border-l-2 border-primary pl-5">
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              Jamie&apos;s founder note will appear here.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
