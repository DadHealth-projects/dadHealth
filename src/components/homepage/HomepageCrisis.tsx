export default function HomepageCrisis() {
  return (
    <aside aria-labelledby="crisis-title" className="border-y border-border bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-6 lg:flex lg:items-center lg:justify-between lg:gap-10 lg:px-8">
        <h2 id="crisis-title" className="font-heading text-xl font-extrabold uppercase sm:text-2xl">
          Struggling right now?
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground lg:mt-0 lg:text-right">
          Call Samaritans free on <a href="tel:116123" className="font-semibold text-foreground underline decoration-primary underline-offset-4 hover:text-primary">116 123</a>, any time. In an emergency, call <a href="tel:999" className="font-semibold text-foreground underline decoration-primary underline-offset-4 hover:text-primary">999</a>.
        </p>
      </div>
    </aside>
  );
}
