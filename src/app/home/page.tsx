"use client";

import Link from "next/link";
import SitePageShell from "@/components/SitePageShell";
import { useAuth } from "@/contexts/AuthContext";

const accountLinks = [
  { href: "/#download", label: "Get the app", description: "Use the current Dad Health experience on iPhone or Android." },
  { href: "/progress", label: "View score", description: "See your current Dad Health Score and pillar values." },
  { href: "/settings", label: "Account settings", description: "Manage account access and connected wearables." },
  { href: "/pricing", label: "Manage Pro", description: "View Pro status or manage your subscription." },
] as const;

export default function HomePage() {
  const { user, loading, openAuthModal } = useAuth();

  return (
    <SitePageShell>
      <section className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-6 lg:px-8 lg:py-16">
        <p className="section-label !p-0">Dad Health account</p>
        <h1 className="mt-4 max-w-3xl font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">
          Continue with Dad Health
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The current Dad Health experience lives in the app. Account and compatibility links remain available here.
        </p>

        {!loading && !user && (
          <button
            type="button"
            onClick={openAuthModal}
            className="mt-7 inline-flex min-h-11 items-center border border-primary px-5 font-heading text-xs font-bold uppercase tracking-wider text-primary"
          >
            Sign in
          </button>
        )}

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {accountLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group border border-border bg-card p-5 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:p-6"
            >
              <span className="font-heading text-xl font-extrabold uppercase group-hover:text-primary">
                {link.label}
              </span>
              <span className="mt-2 block text-sm leading-relaxed text-muted-foreground">
                {link.description}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </SitePageShell>
  );
}
