import { marketingPageHeroClass, marketingSectionClass } from "@/components/marketing/marketingStyles";

export default function AboutHero() {
  return (
    <section className="border-b border-border bg-background text-foreground">
      <div className={marketingSectionClass}>
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">About Dad Health</p>
        <h1 className={`mt-6 max-w-6xl ${marketingPageHeroClass}`}>
          The advice we wish we&rsquo;d had sooner.
        </h1>
        <p className="mt-7 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-xl">
          Dad Health is a mental health, fitness and parenting app built for dads, by dads.
        </p>
      </div>
    </section>
  );
}
