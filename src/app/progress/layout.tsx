import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Progress",
  description: "Your current Dad Health Score across Mind, Body and Bond.",
  robots: { index: false, follow: false },
};

export default function ProgressLayout({ children }: { children: React.ReactNode }) {
  return children;
}
