import Link from "next/link";

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
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">Legal</p>
        <h1 className="mt-6 max-w-6xl font-heading text-[3.6rem] font-extrabold uppercase leading-[0.84] tracking-[-0.035em] sm:text-7xl lg:text-[4.5rem] xl:text-[5rem] min-[1440px]:text-[5.5rem] 2xl:text-[6.5rem]">
          {title}
        </h1>
        <nav aria-label="Legal documents" className="mt-8 flex flex-wrap gap-2">
          {legalRoutes.map((route) => {
            const active = route.href === currentPath;

            return (
              <Link
                key={route.href}
                href={route.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center justify-center rounded-xl border px-5 font-heading text-sm font-extrabold uppercase tracking-[0.08em] shadow-[0_0_16px_hsl(var(--primary)/0.04)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-foreground hover:border-primary hover:text-primary"
                }`}
              >
                {route.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </section>
  );
}
