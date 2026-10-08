"use client";

import Link from "next/link";
import { useState } from "react";
import Logo from "@/components/Logo";
import HomepagePrimaryButton from "@/components/homepage/HomepagePrimaryButton";
import { marketingArrowClass } from "@/components/marketing/marketingStyles";

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
    <header className="relative z-50 border-b border-border bg-background">
      <div className="flex h-14 w-full items-center gap-3 px-4">
        <Link href="/" aria-label="Dad Health home" className="shrink-0">
          <Logo />
        </Link>

        <nav
          aria-label="Main navigation"
          className="ml-auto hidden items-center gap-6 lg:flex xl:gap-8 min-[1440px]:gap-10"
        >
          {navigation.map((item) => {
            const active = item.label === "Corporate";

            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative pb-2 font-heading text-sm font-bold uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:text-primary ${
                  active
                    ? "text-primary"
                    : "text-foreground hover:text-primary"
                }`}
              >
                {item.label}

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

        <HomepagePrimaryButton
          href="/business/contact"
          className="ml-auto lg:ml-4 xl:ml-6 min-[1440px]:ml-8"
        >
          Talk to us
          <span aria-hidden="true" className={marketingArrowClass}>
            &rarr;
          </span>
        </HomepagePrimaryButton>

        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="business-mobile-navigation"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((open) => !open)}
          className="flex size-11 shrink-0 flex-col items-center justify-center gap-1.5 rounded-lg text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
        >
          <span
            className={`h-0.5 w-6 bg-current transition-transform ${
              menuOpen ? "translate-y-2 rotate-45" : ""
            }`}
          />
          <span
            className={`h-0.5 w-6 bg-current transition-opacity ${
              menuOpen ? "opacity-0" : ""
            }`}
          />
          <span
            className={`h-0.5 w-6 bg-current transition-transform ${
              menuOpen ? "-translate-y-2 -rotate-45" : ""
            }`}
          />
        </button>
      </div>

      {menuOpen && (
        <nav
          id="business-mobile-navigation"
          aria-label="Mobile navigation"
          className="absolute inset-x-0 top-full z-50 isolate overflow-hidden rounded-b-xl border border-t-0 border-border bg-background px-4 py-3 shadow-[0_18px_30px_hsl(var(--background))] lg:hidden"
        >
          {navigation.map((item) => {
            const active = item.label === "Corporate";

            return (
              <Link
                key={item.label}
                href={item.href}
                aria-current={active ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
                className={`relative flex min-h-11 w-fit items-center font-heading text-lg font-bold uppercase tracking-[0.1em] transition-colors ${
                  active
                    ? "text-primary"
                    : "text-foreground hover:text-primary"
                }`}
              >
                {item.label}

                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-1 left-0 h-[3px] w-7 rounded-full bg-primary"
                  />
                )}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}