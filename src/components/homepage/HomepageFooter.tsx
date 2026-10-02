import Link from "next/link";
import Logo from "@/components/Logo";

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
      <div className="mx-auto max-w-7xl px-5 pb-5 pt-12 sm:px-6 lg:px-8 lg:pb-6 lg:pt-16">
        <div>
          <Link
            href="/"
            aria-label="Dad Health home"
            className="inline-block"
          >
            <Logo />
          </Link>

          <div className="mt-5 flex flex-col gap-9 lg:flex-row lg:items-start lg:justify-between">
            <address className="max-w-sm text-xs not-italic leading-relaxed text-muted-foreground">
              Dad Health Ltd · Company No. 17407334
              <br />
              66 Paul Street, London EC2A 4NA
            </address>

            <nav
              aria-label="Footer navigation"
              className="grid w-full grid-cols-2 sm:flex sm:w-auto sm:flex-wrap sm:gap-7 lg:w-auto"
            >
              {footerLinks.map((item, index) => {
                const isRightColumn = index % 2 === 1;

                const className = `inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-primary sm:min-h-0 ${
                  isRightColumn
                    ? "w-20 justify-self-end text-left sm:w-auto sm:justify-self-auto"
                    : "justify-self-start sm:justify-self-auto"
                }`;

                return item.href ? (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={className}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    key={item.label}
                    className={`inline-flex min-h-11 items-center text-sm text-muted-foreground sm:min-h-0 ${
                      isRightColumn
                        ? "w-20 justify-self-end text-left sm:w-auto sm:justify-self-auto"
                        : "justify-self-start sm:justify-self-auto"
                    }`}
                  >
                    {item.label}
                  </span>
                );
              })}
            </nav>
          </div>
        </div>

        <div className="mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
          <a
            href="mailto:hello@dadhealth.co.uk"
            className="inline-flex min-h-11 items-center transition-colors hover:text-primary sm:min-h-0"
          >
            hello@dadhealth.co.uk
          </a>
        </div>
      </div>
    </footer>
  );
}
