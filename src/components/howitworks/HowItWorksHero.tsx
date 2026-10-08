import { marketingPageHeroClass, marketingSectionClass } from "@/components/marketing/marketingStyles";

export default function HowItWorksHero() {
  return (
    <section className="border-b border-border bg-background text-foreground">
      <div className={marketingSectionClass}>
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">
          How it works
        </p>
        <h1 className={`mt-6 max-w-5xl ${marketingPageHeroClass}`}>
          One score. Three <br className="hidden sm:block" />pillars.
        </h1>
        <p className="mt-7 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-xl">
          The Dad Health Score shows how you are doing across Mind, Body and Bond, then gives you one thing to do today.
        </p>
      </div>
    </section>
  );
}
