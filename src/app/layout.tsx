import type { Metadata, Viewport } from "next";
import Providers from "./providers";
import "../index.css";
import { OG_HERO_IMAGE } from "@/lib/images";
import AnalyticsConsent from "@/components/analytics/AnalyticsConsent";
import { SITE_URL } from "@/lib/marketingMetadata";

export const viewport: Viewport = {
  themeColor: "hsl(0, 0%, 4%)",
};

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: {
    default: "Dad Health — Be the Stronger Dad",
    template: "%s | Dad Health",
  },
  description:
    "Built for dads, by dads. Fitness, mental health, bonding and community — kill the old version of you. Be the stronger dad, mentally, physically and as a parent.",
  keywords: ["dad health", "fitness", "mental health", "parenting", "fathers", "dads"],
  authors: [{ name: "Dad Health", url: SITE_URL }],
  openGraph: {
    title: "Dad Health — Be the Stronger Dad",
    description: "Built for dads, by dads. Fitness, mental health, bonding and community.",
    type: "website",
    url: SITE_URL,
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
      <body className="min-h-dvh" suppressHydrationWarning>
        <Providers>{children}</Providers>
        <AnalyticsConsent />
      </body>
    </html>
  );
}

