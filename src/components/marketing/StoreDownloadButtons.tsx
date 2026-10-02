interface StoreDownloadButtonsProps {
  id?: string;
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
        border-2 border-foreground px-3 py-2 text-left
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

export default function StoreDownloadButtons({ id }: StoreDownloadButtonsProps) {
  return (
    <div id={id} className="mt-7 flex flex-row gap-2 sm:flex-wrap sm:gap-3">
      <StoreButton eyebrow="Download on the" label="App Store" />
      <StoreButton eyebrow="Get it on" label="Google Play" />
    </div>
  );
}
