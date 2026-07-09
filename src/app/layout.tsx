import type { Metadata, Viewport } from "next";
import Script from "next/script";
import Providers from "./providers";
import "../index.css";
import { OG_HERO_IMAGE } from "@/lib/images";

export const viewport: Viewport = {
  themeColor: "hsl(0, 0%, 4%)",
};

export const metadata: Metadata = {
  title: {
    default: "Dad Health — Be the Stronger Dad",
    template: "%s | Dad Health",
  },
  description:
    "Built for dads, by dads. Fitness, mental health, bonding and community — kill the old version of you. Be the stronger dad, mentally, physically and as a parent.",
  keywords: ["dad health", "fitness", "mental health", "parenting", "fathers", "dads"],
  authors: [{ name: "Dad Health", url: "https://dadhealth.co.uk" }],
  openGraph: {
    title: "Dad Health — Be the Stronger Dad",
    description: "Built for dads, by dads. Fitness, mental health, bonding and community.",
    type: "website",
    url: "https://dadhealth.co.uk",
    images: [OG_HERO_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: "Dad Health — Be the Stronger Dad",
    images: [OG_HERO_IMAGE],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full bg-background" suppressHydrationWarning>
      <Script
        id="gtm-script"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-K6SX8SKZ');`,
        }}
      />

      <body className="min-h-dvh" suppressHydrationWarning>
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-K6SX8SKZ"
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          />
        </noscript>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

