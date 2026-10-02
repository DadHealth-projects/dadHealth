type BrandPhoneProps = {
  brand: string;
  caption: string;
  branded?: boolean;
};

function ScoreRing({ branded }: { branded: boolean }) {
  const colour = branded ? "text-blue-400" : "text-primary";

  return (
    <div className={`relative mx-auto grid size-24 place-items-center ${colour}`}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle className="text-muted" cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" />
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" pathLength="100" strokeDasharray="71 29" strokeLinecap="round" />
      </svg>
      <span className="relative font-heading text-3xl font-extrabold text-foreground">71</span>
    </div>
  );
}

function BrandPhone({ brand, caption, branded = false }: BrandPhoneProps) {
  const borderColour = branded ? "border-blue-400" : "border-primary";
  const brandColour = branded ? "text-blue-400" : "text-muted-foreground";
  const buttonColour = branded ? "bg-blue-400" : "bg-primary";

  return (
    <figure className="w-52">
      <div className={`flex h-96 flex-col gap-4 rounded-3xl border-4 bg-card p-5 shadow-[0_0_24px_hsl(var(--primary)/0.06)] ${borderColour}`}>
        <p className={`font-heading text-sm font-extrabold uppercase tracking-[0.06em] ${brandColour}`}>{brand}</p>
        <p className="font-heading text-2xl font-extrabold uppercase leading-none">Good morning, Sam</p>
        <ScoreRing branded={branded} />
        <div className="h-10 rounded-xl border border-border bg-muted" />
        <div className="h-10 rounded-xl border border-border bg-muted" />
        <div className={`mt-auto grid min-h-11 place-items-center rounded-xl font-heading text-sm font-extrabold uppercase tracking-[0.05em] text-primary-foreground ${buttonColour}`}>
          Start check-in
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

export default function BusinessBranding() {
  return (
    <section id="your-brand" className="border-t border-border bg-card text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <h2 className="font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">
          Your own version of Dad Health
        </h2>
        <p className="mt-5 max-w-5xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          For organisations with 100 or more eligible sign-ups we can put your name on it: your logo, your colours and a welcome from your team, so it feels like part of your benefits package.
        </p>

        <div className="mt-12 flex flex-col items-center justify-center gap-7 sm:flex-row">
          <BrandPhone brand="Dad Health" caption="Standard" />
          <span aria-hidden="true" className="rotate-90 font-heading text-5xl font-extrabold text-primary sm:rotate-0">→</span>
          <BrandPhone brand="Acme Logistics" caption="Branded for your company (illustrative)" branded />
        </div>
      </div>
    </section>
  );
}
