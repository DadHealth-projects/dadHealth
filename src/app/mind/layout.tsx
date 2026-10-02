import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mental Health",
  description: "Mental health check-ins, breathing exercises, journal, therapist and counsellor directory.",
  robots: { index: false, follow: false },
};

export default function MindLayout({ children }: { children: React.ReactNode }) {
  return children;
}
