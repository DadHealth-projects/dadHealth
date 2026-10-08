import HomepagePrimaryButton from "@/components/homepage/HomepagePrimaryButton";

function TodayPhone() {
  return (
    <div
      aria-label="Preview of the Dad Health Today screen"
      className="relative mx-auto flex w-[280px] shrink-0 flex-col gap-3 rounded-[3rem] border-[11px] border-card bg-background px-4 pb-5 pt-10 shadow-[0_0_0_1px_hsl(var(--border)),0_0_32px_hsl(var(--primary)/0.12)] sm:w-[320px] sm:gap-4 sm:px-5 sm:pb-6 sm:pt-11 lg:mx-0"
    >
      <span aria-hidden="true" className="absolute left-1/2 top-2 h-5 w-24 -translate-x-1/2 rounded-full bg-card" />
      <span aria-hidden="true" className="absolute -right-[15px] top-24 h-14 w-1.5 rounded-r-md border-y border-r border-border bg-card" />
      <div>
        <p className="font-heading text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Good morning, Tom</p>
        <p className="font-heading text-xl font-extrabold uppercase leading-none sm:text-2xl">How are you today?</p>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-[0_0_18px_hsl(var(--primary)/0.05)] sm:gap-4 sm:p-4">
        <div className="relative size-20 shrink-0 sm:size-24">
          <svg viewBox="0 0 104 104" aria-hidden="true" className="size-full -rotate-90">
            <circle cx="52" cy="52" r="44" fill="none" stroke="currentColor" strokeWidth="10" className="text-border" />
            <circle cx="52" cy="52" r="44" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeDasharray="199 277" className="text-primary" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <strong className="font-heading text-3xl font-extrabold leading-none sm:text-4xl">71</strong>
            <span className="text-[7px] uppercase tracking-[0.16em] text-muted-foreground">Dad score</span>
          </div>
        </div>

        <div className="min-w-0 flex-1 font-heading text-sm font-bold uppercase tracking-[0.06em] sm:text-base">
          <p className="flex justify-between"><span>Mind</span><span>68 <span className="text-primary">↑</span></span></p>
          <p className="flex justify-between"><span>Body</span><span>81 <span className="text-primary">↑</span></span></p>
          <p className="-mx-1 flex justify-between rounded-sm bg-primary px-1 text-primary-foreground"><span>Bond</span><span>64 ↓</span></p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-[0_0_18px_hsl(var(--primary)/0.05)]">
        <p className="font-heading text-[10px] font-extrabold uppercase tracking-[0.2em] text-primary">Your one focus</p>
        <p className="mt-1 font-heading text-base font-extrabold uppercase leading-tight sm:text-lg">60 minutes. Phone down. Just you and them.</p>
        <p className="mt-1 text-[10px] text-muted-foreground">Present Dad Mode · logs to your Bond score</p>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 shadow-[0_0_18px_hsl(var(--primary)/0.05)]">
        <span className="font-heading text-sm font-extrabold uppercase sm:text-base">Daily check-in</span>
        <span className="text-[10px] text-muted-foreground">3 questions · 1 min</span>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 shadow-[0_0_18px_hsl(var(--primary)/0.05)]">
        <span className="font-heading text-sm font-extrabold uppercase sm:text-base">14-day streak</span>
        <span className="font-heading text-lg font-extrabold text-primary">14</span>
      </div>
    </div>
  );
}

export default function HomepageHero() {
  return (
    <section id="top" className="bg-background">
      <div className="mx-auto grid max-w-7xl items-start gap-10 px-5 pb-12 pt-8 sm:px-6 sm:pb-14 sm:pt-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12 lg:px-8 lg:pb-6 lg:pt-7 xl:gap-16 xl:pb-6 xl:pt-9 min-[1440px]:gap-24 min-[1440px]:pb-8 min-[1440px]:pt-10">
        <div className="max-w-3xl lg:pt-16 xl:pt-10 min-[1440px]:pt-24">
          <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">Built for dads, by dads</p>
          <h1 className="mt-6 font-heading text-[3.6rem] font-extrabold uppercase leading-[0.84] tracking-[-0.035em] sm:text-7xl lg:text-[5.25rem] xl:text-[5.5rem] min-[1440px]:text-[6.5rem]">
            How are you <span className="text-primary">doing,</span> Dad?
          </h1>
          <p className="mt-7 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-xl">
            One score for your Mind, Body and Bond. One thing to do today.
          </p>
         <HomepagePrimaryButton href="#waitlist" className="mt-7">
  Join the waitlist
  <span aria-hidden="true" className="ml-2">
    →
  </span>
</HomepagePrimaryButton>
        </div>

        <TodayPhone />
      </div>
    </section>
  );
}
