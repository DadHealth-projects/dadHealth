import { marketingPageHeroClass, marketingSectionClass } from "@/components/marketing/marketingStyles";

export default function CommunityHero() {
  return (
    <section className="border-b border-border bg-background text-foreground">
      <div className={marketingSectionClass}>
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">
          Community
        </p>
        <h1 className={`mt-6 ${marketingPageHeroClass}`}>
          Dad Circles
        </h1>
        <p className="mt-7 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-xl">
          Find dads going through the same chapter as you.
        </p>
      </div>
    </section>
  );
}
