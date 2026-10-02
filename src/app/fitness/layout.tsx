import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fitness and nutrition",
  description: "Dad Strength workouts, nutrition articles, meal planner, progress tracking.",
  robots: { index: false, follow: false },
};

export default function FitnessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
