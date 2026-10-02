import Link from "next/link";
import SitePageShell from "@/components/SitePageShell";
import HomepageCrisis from "@/components/homepage/HomepageCrisis";

export default function MindPage() {
  return (
    <SitePageShell>
      <section className="mx-auto flex w-full max-w-5xl flex-1 items-center px-5 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="max-w-2xl">
          <p className="section-label !p-0">Mind</p>
          <h1 className="mt-4 font-heading text-4xl font-extrabold uppercase leading-none sm:text-5xl">
            Continue in the app
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Current Dad Health Mind features are available in the Dad Health app.
          </p>
          <Link
            href="/#download"
            className="mt-7 inline-flex min-h-11 items-center bg-primary px-5 font-heading text-xs font-bold uppercase tracking-wider text-primary-foreground"
          >
            Get the app
          </Link>
        </div>
      </section>
      <HomepageCrisis />
    </SitePageShell>
  );
}
