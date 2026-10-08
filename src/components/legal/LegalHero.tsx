import Link from "next/link";
import {
  marketingPageHeroClass,
  marketingSectionClass,
} from "@/components/marketing/marketingStyles";

const legalRoutes = [
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "EULA", href: "/eula" },
  { label: "Cookies", href: "/cookies" },
] as const;

interface LegalHeroProps {
  title: string;
  currentPath: (typeof legalRoutes)[number]["href"];
}

export default function LegalHero({ title, currentPath }: LegalHeroProps) {
  return (
    <section className="border-b border-border bg-background text-foreground">
      <div className={marketingSectionClass}>
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">
          Legal
        </p>

        <h1 className={`mt-6 max-w-6xl ${marketingPageHeroClass}`}>
          {title}
        </h1>

        <nav
          aria-label="Legal documents"
          className="mt-8 flex flex-wrap gap-7"
        >
          {legalRoutes.map((route) => {
            const active = route.href === currentPath;

            return (
              <Link
                key={route.href}
                href={route.href}
                aria-current={active ? "page" : undefined}
                className={`relative pb-2 font-heading text-sm font-extrabold uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:text-primary ${
                  active
                    ? "text-primary"
                    : "text-foreground hover:text-primary"
                }`}
              >
                {route.label}

                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-1/2 h-[3px] w-7 -translate-x-1/2 rounded-full bg-primary"
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </section>
  );
}