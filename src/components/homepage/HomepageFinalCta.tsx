import StoreDownloadButtons from "@/components/marketing/StoreDownloadButtons";

export default function HomepageFinalCta() {
  return (
    <section className="border-t border-border bg-card text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-6 sm:py-16 lg:flex lg:items-end lg:justify-between lg:gap-12 lg:px-8 lg:py-16">
        <div className="max-w-2xl">
          <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary">
            Dad Health app
          </p>
          <h2 className="mt-4 font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl">
            Get the app.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Free forever. Pro when you want it personal.
          </p>
        </div>

        <StoreDownloadButtons prelaunch />
      </div>
    </section>
  );
}
