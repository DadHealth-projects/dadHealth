import Link from "next/link";
import SitePageShell from "@/components/SitePageShell";

export default function CommunityPage() {
  return (
    <SitePageShell>
      <section className="mx-auto flex w-full max-w-5xl flex-1 items-center px-5 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="max-w-2xl">
          <p className="section-label !p-0">Dad Circles</p>
          <h1 className="mt-4 font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">
            Community lives in the app
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Learn about Dad Circles on the public website, then join the conversation in the Dad Health app.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/dad-circles"
              className="inline-flex min-h-11 items-center bg-primary px-5 font-heading text-xs font-bold uppercase tracking-wider text-primary-foreground"
            >
              Explore Dad Circles
            </Link>
            <Link
              href="/#download"
              className="inline-flex min-h-11 items-center border border-primary px-5 font-heading text-xs font-bold uppercase tracking-wider text-primary"
            >
              Get the app
            </Link>
          </div>
        </div>
      </section>
    </SitePageShell>
  );
}
