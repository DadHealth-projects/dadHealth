import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bond",
  description: "Present Dad Mode, dad dates, milestones, conversation starters.",
  robots: { index: false, follow: false },
};

export default function BondLayout({ children }: { children: React.ReactNode }) {
  return children;
}
