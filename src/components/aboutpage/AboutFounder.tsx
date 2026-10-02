export default function AboutFounder() {
  return (
    <section className="bg-card text-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center lg:gap-10 xl:gap-14 min-[1440px]:gap-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <div className="flex min-h-72 items-center justify-center bg-muted p-8 text-center sm:min-h-96 lg:min-h-72 xl:min-h-80 min-[1440px]:min-h-96">
          <p className="max-w-xs text-sm text-muted-foreground">Jamie&rsquo;s founder photo is pending.</p>
        </div>
        <div>
          <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">From Jamie, founder</p>
          <h2 className="mt-5 font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">Why I started it</h2>
          <div className="mt-6 border-l-2 border-primary pl-5">
            <p className="text-base leading-relaxed text-muted-foreground">Jamie&rsquo;s first-person founder note is pending.</p>
            <p className="mt-4 text-sm text-muted-foreground">Founder attribution pending.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
