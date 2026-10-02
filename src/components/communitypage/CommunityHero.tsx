export default function CommunityHero() {
  return (
    <section className="border-b border-border bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">
          Community
        </p>
        <h1 className="mt-6 font-heading text-[3.6rem] font-extrabold uppercase leading-[0.84] tracking-[-0.035em] sm:text-7xl lg:text-[4.5rem] xl:text-[5rem] min-[1440px]:text-[5.5rem] 2xl:text-[6.5rem]">
          Dad Circles
        </h1>
        <p className="mt-7 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-xl">
          Find dads going through the same chapter as you.
        </p>
      </div>
    </section>
  );
}
