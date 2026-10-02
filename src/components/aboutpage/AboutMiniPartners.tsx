export default function AboutMiniPartners() {
  return (
    <section className="bg-card text-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center lg:gap-10 xl:gap-14 min-[1440px]:gap-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <div>
          <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">Train Mini Partners</p>
          <h2 className="mt-5 max-w-xl font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">Train together on Sundays</h2>
          <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">Hyrox-style parent and child workouts at Train, powered by Dad Health.</p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">Times, ages and booking details are pending.</p>
        </div>
        <div className="flex min-h-72 items-center justify-center rounded-2xl border border-border bg-muted p-8 text-center shadow-[0_0_20px_hsl(var(--primary)/0.04)] sm:min-h-96 lg:min-h-72 xl:min-h-80 min-[1440px]:min-h-96">
          <p className="max-w-xs text-sm text-muted-foreground">Mini Partners session photo is pending.</p>
        </div>
      </div>
    </section>
  );
}
