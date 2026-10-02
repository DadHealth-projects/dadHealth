import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Dad Health Pro — full access to workouts, meal planner, mood graphs and more.",
  robots: { index: false, follow: false },
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
