import Link from "next/link";
import type { ReactNode } from "react";

type HomepagePrimaryButtonProps = {
  href: string;
  children: ReactNode;
  className?: string;
};

export const homepagePrimaryButtonClass =
  "inline-flex min-h-10 w-fit items-center justify-center rounded-xl border border-primary bg-primary px-3 font-heading text-[11px] font-extrabold uppercase tracking-[0.04em] text-primary-foreground shadow-[0_0_18px_hsl(var(--primary)/0.10)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 lg:min-h-11 lg:px-5 lg:text-xs lg:tracking-[0.06em]";

export default function HomepagePrimaryButton({
  href,
  children,
  className = "",
}: HomepagePrimaryButtonProps) {
  return (
    <Link
      href={href}
      className={`${homepagePrimaryButtonClass} ${className}`}
    >
      {children}
    </Link>
  );
}