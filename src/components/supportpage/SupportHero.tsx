import { marketingPageHeroClass, marketingSectionClass } from "@/components/marketing/marketingStyles";

export default function SupportHero() {
  return (
    <section className="border-b border-border bg-background text-foreground">
      <div className={marketingSectionClass}>
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">Support</p>
        <h1 className={`mt-6 max-w-5xl ${marketingPageHeroClass}`}>
          How can we help?
        </h1>
      </div>
    </section>
  );
}
