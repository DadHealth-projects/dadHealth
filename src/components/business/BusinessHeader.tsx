"use client";

import Link from "next/link";
import { useState } from "react";
import Logo from "@/components/Logo";

const navigation = [
  { label: "How it works", href: "/howitworks" },
  { label: "Free & Pro", href: "/free-and-pro" },
  { label: "Community", href: "/dad-circles" },
  { label: "Corporate", href: "/business" },
  { label: "About", href: "/about" },
];

export default function BusinessHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="relative z-20 border-b border-border bg-background">
      <div className="flex h-14 w-full items-center gap-3 px-4">
        <Link href="/" aria-label="Dad Health home" className="shrink-0">
          <Logo />
        </Link>

        <nav aria-label="Main navigation" className="ml-auto hidden items-center gap-6 lg:flex xl:gap-8 min-[1440px]:gap-10">
          {navigation.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`font-heading text-sm font-bold uppercase tracking-[0.14em] transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none ${
                item.label === "Corporate" ? "text-primary" : "text-foreground"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/business/contact"
          className="ml-auto inline-flex min-h-11 items-center justify-center rounded-xl border border-primary bg-primary px-4 font-heading text-sm font-extrabold uppercase tracking-[0.08em] text-primary-foreground shadow-[0_0_18px_hsl(var(--primary)/0.10)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:-mr-2 lg:ml-4 lg:min-h-12 lg:px-5 xl:-mr-3 xl:ml-6 xl:min-h-[3.25rem] xl:px-6 min-[1440px]:-mr-4 min-[1440px]:ml-8 min-[1440px]:min-h-14 min-[1440px]:px-7"
        >
          Talk to us <span aria-hidden="true" className="ml-2">&rarr;</span>
        </Link>

        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="business-mobile-navigation"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((open) => !open)}
          className="flex size-11 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
        >
          <span className="h-0.5 w-6 bg-current" />
          <span className="h-0.5 w-6 bg-current" />
          <span className="h-0.5 w-6 bg-current" />
        </button>
      </div>

      {menuOpen && (
        <nav
          id="business-mobile-navigation"
          aria-label="Mobile navigation"
          className="absolute inset-x-0 top-full rounded-b-xl border-y border-border bg-background px-4 py-3 shadow-[0_10px_24px_hsl(var(--background)/0.35)] lg:hidden"
        >
          {navigation.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className="flex min-h-11 items-center border-b border-border font-heading text-lg font-bold uppercase tracking-[0.1em] last:border-b-0"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
