interface StoreDownloadButtonsProps {
  id?: string;
  prelaunch?: boolean;
}

function StoreButton({
  eyebrow,
  label,
}: {
  eyebrow: string;
  label: string;
}) {
  return (
    <div
      className="
        flex min-h-12 min-w-0 flex-1 items-center justify-between
        rounded-xl border-2 border-foreground bg-card px-3 py-2 text-left
        shadow-[0_0_18px_hsl(var(--primary)/0.05)]
        sm:min-h-14 sm:min-w-44 sm:px-5
        lg:w-[200px] lg:flex-none lg:flex-col lg:items-start lg:justify-center
      "
    >
      <span className="hidden text-[10px] leading-none text-muted-foreground lg:block">
        {eyebrow}
      </span>

      <span className="font-heading text-sm font-extrabold uppercase leading-none sm:text-xl lg:mt-1">
        {label}
      </span>

      <span aria-hidden="true" className="font-heading text-xl lg:hidden">
        →
      </span>
    </div>
  );
}

export default function StoreDownloadButtons({ id, prelaunch = false }: StoreDownloadButtonsProps) {
  if (prelaunch) {
    return (
      <div id={id} className="mt-7 flex flex-wrap items-center gap-3">
        <span className="inline-flex min-h-12 items-center rounded-xl border border-border bg-card px-4 font-heading text-sm font-extrabold uppercase tracking-[0.08em] text-foreground shadow-[0_0_18px_hsl(var(--primary)/0.05)]">
          Coming soon on iPhone
        </span>
        <span className="inline-flex min-h-12 items-center rounded-xl border border-border bg-card px-4 font-heading text-sm font-extrabold uppercase tracking-[0.08em] text-foreground shadow-[0_0_18px_hsl(var(--primary)/0.05)]">
          Coming soon to Android
        </span>
      </div>
    );
  }

  return (
    <div id={id} className="mt-7 flex flex-row gap-2 sm:flex-wrap sm:gap-3">
      <StoreButton eyebrow="Download on the" label="App Store" />
      <StoreButton eyebrow="Get it on" label="Google Play" />
    </div>
  );
}
