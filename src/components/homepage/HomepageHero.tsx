import StoreDownloadButtons from "@/components/marketing/StoreDownloadButtons";

function TodayPhone() {
  return (
    <div
      aria-label="Preview of the Dad Health Today screen"
      className="mx-auto flex w-[280px] shrink-0 flex-col gap-3 rounded-[2.75rem] border-[9px] border-card bg-background px-4 pb-5 pt-8 shadow-[0_0_0_1px_hsl(var(--border))] sm:w-[320px] sm:gap-4 sm:px-5 sm:pb-6 sm:pt-10 lg:mx-0"
    >
      <div>
        <p className="font-heading text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Good morning, Tom</p>
        <p className="font-heading text-xl font-extrabold uppercase leading-none sm:text-2xl">How are you today?</p>
      </div>

      <div className="flex items-center gap-3 rounded-2xl bg-card p-3 sm:gap-4 sm:p-4">
        <div className="relative size-20 shrink-0 sm:size-24">
          <svg viewBox="0 0 104 104" aria-hidden="true" className="size-full -rotate-90">
            <circle cx="52" cy="52" r="44" fill="none" stroke="currentColor" strokeWidth="10" className="text-border" />
            <circle cx="52" cy="52" r="44" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeDasharray="199 277" className="text-primary" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <strong className="font-heading text-3xl font-extrabold leading-none sm:text-4xl">72</strong>
            <span className="text-[7px] uppercase tracking-[0.16em] text-muted-foreground">Dad score</span>
          </div>
        </div>

        <div className="min-w-0 flex-1 font-heading text-sm font-bold uppercase tracking-[0.06em] sm:text-base">
          <p className="flex justify-between"><span>Mind</span><span>68 <span className="text-primary">↑</span></span></p>
          <p className="flex justify-between"><span>Body</span><span>81 <span className="text-primary">↑</span></span></p>
          <p className="-mx-1 flex justify-between bg-primary px-1 text-primary-foreground"><span>Bond</span><span>64 ↓</span></p>
        </div>
      </div>

      <div className="rounded-2xl bg-card px-4 py-3">
        <p className="font-heading text-[10px] font-extrabold uppercase tracking-[0.2em] text-primary">Your one focus</p>
        <p className="mt-1 font-heading text-base font-extrabold uppercase leading-tight sm:text-lg">60 minutes. Phone down. Just you and them.</p>
        <p className="mt-1 text-[10px] text-muted-foreground">Present Dad Mode · logs to your Bond score</p>
      </div>

      <div className="flex items-center justify-between rounded-2xl bg-card px-4 py-3">
        <span className="font-heading text-sm font-extrabold uppercase sm:text-base">Daily check-in</span>
        <span className="text-[10px] text-muted-foreground">3 questions · 1 min</span>
      </div>

      <div className="flex items-center justify-between rounded-2xl bg-card px-4 py-3">
        <span className="font-heading text-sm font-extrabold uppercase sm:text-base">14-day streak</span>
        <span className="font-heading text-lg font-extrabold text-primary">14</span>
      </div>
    </div>
  );
}

export default function HomepageHero() {
  return (
    <section id="top" className="bg-background">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12 xl:gap-16 min-[1440px]:gap-24 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <div className="max-w-3xl">
          <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">Built for dads, by dads</p>
          <h1 className="mt-6 font-heading text-[3.6rem] font-extrabold uppercase leading-[0.84] tracking-[-0.035em] sm:text-7xl lg:text-[5.25rem] xl:text-[5.5rem] min-[1440px]:text-[6.5rem]">
            How are you <span className="text-primary">doing,</span> Dad?
          </h1>
          <p className="mt-7 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-xl">
            One score for your Mind, Body and Bond. One thing to do today. Free on iPhone and Android.
          </p>

          <StoreDownloadButtons id="download" />

          <p className="mt-5 text-sm text-muted-foreground">Free forever. Pro when you want it personal.</p>
        </div>

        <TodayPhone />
      </div>
    </section>
  );
}
