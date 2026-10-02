"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile, type UserProfileRow } from "@/hooks/useUserProfile";
import OnboardingModal from "./OnboardingModal";
import Phase1OnboardingModal from "./Phase1OnboardingModal";

// Phase 1 (sign-up questionnaire) is complete once the four required fields
// have been saved. Pronouns (Q3) is optional per the onboarding spec, so it is
// not part of the completion check.
function isPhase1Complete(profile: UserProfileRow | null | undefined): boolean {
  if (!profile) return false;
  if (!profile.display_name || !profile.display_name.trim()) return false;
  if (!profile.parent_type) return false;
  if (!profile.custody_arrangement) return false;
  const ages = profile.kids_ages;
  if (!Array.isArray(ages) || ages.length === 0) return false;
  return true;
}

export default function OnboardingCheck() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { data: profile, isLoading } = useUserProfile(user?.id);
  const [dismissed, setDismissed] = useState(false);

  if (pathname === "/") return null;
  if (!user?.id || isLoading) return null;

  // Phase 1 blocks everything else — it must complete before the home screen
  // is accessible. No dismiss path.
  if (!isPhase1Complete(profile)) {
    return <Phase1OnboardingModal open userId={user.id} profile={profile} />;
  }

  // Legacy onboarding (goals + pillar order) — kept untouched until later
  // phases are built out. It is dismissible via "Skip for now".
  const showLegacyOnboarding =
    !dismissed && (profile === null || profile?.onboarding_complete === false);

  if (!showLegacyOnboarding) return null;

  return (
    <OnboardingModal
      open
      onClose={() => setDismissed(true)}
      userId={user.id}
    />
  );
}
