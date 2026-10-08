import Link from "next/link";
import Logo from "@/components/Logo";
import { marketingContainerClass } from "@/components/marketing/marketingStyles";

const footerLinks = [
  { label: "Support", href: "/support" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "EULA", href: "/eula" },
  { label: "Cookies", href: "/cookies" },
  { label: "Instagram" },
  { label: "Contact", href: "mailto:hello@dadhealth.co.uk" },
  { label: "Corporate", href: "/business" },
];

export default function HomepageFooter() {
  return (
    <footer className="bg-background text-foreground">
      <div className={`${marketingContainerClass} pb-6 pt-12 lg:pt-14`}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-12">
          <div>
            <Link href="/" aria-label="Dad Health home" className="inline-block">
              <Logo />
            </Link>
            <address className="mt-5 max-w-sm text-sm not-italic leading-relaxed text-muted-foreground">
              Dad Health Ltd &middot; Company No. 17407334
              <br />
              66 Paul Street, London EC2A 4NA
            </address>
            <a
              href="mailto:hello@dadhealth.co.uk"
              className="mt-3 inline-flex min-h-11 items-center text-sm text-foreground/80 transition-colors hover:text-primary"
            >
              hello@dadhealth.co.uk
            </a>
          </div>

          <nav
            aria-label="Footer navigation"
            className="grid grid-cols-2 gap-x-8 sm:grid-cols-4 sm:gap-x-10 lg:gap-x-8"
          >
            {footerLinks.map((item) => {
              const className = "inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-primary";

              return item.href ? (
                <Link key={item.label} href={item.href} className={className}>
                  {item.label}
                </Link>
              ) : (
                <span key={item.label} className="inline-flex min-h-11 items-center text-sm text-muted-foreground">
                  {item.label}
                </span>
              );
            })}
          </nav>
        </div>
      </div>
    </footer>
  );
}
