import { marketingPageHeroClass, marketingSectionClass } from "@/components/marketing/marketingStyles";

export default function FreeProHero() {
  return (
    <section className="border-b border-border bg-background text-foreground">
      <div className={marketingSectionClass}>
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">
          Free &amp; Pro
        </p>
        <h1 className={`mt-6 max-w-5xl ${marketingPageHeroClass}`}>
          Free is the real thing.
        </h1>
        <p className="mt-7 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-xl">
          Free gives you the score, the check-in and everything you need to look after yourself. Pro makes it personal.
        </p>
      </div>
    </section>
  );
}
