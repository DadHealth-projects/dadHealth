import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Manage Dad Health Pro subscription and billing.",
  robots: { index: false, follow: false },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
