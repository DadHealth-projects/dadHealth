import HomepageCrisis from "@/components/homepage/HomepageCrisis";
import HomepageFooter from "@/components/homepage/HomepageFooter";
import HomepageHeader from "@/components/homepage/HomepageHeader";
import LegalDocument from "@/components/legal/LegalDocument";
import LegalHero from "@/components/legal/LegalHero";
import { createMarketingMetadata } from "@/lib/marketingMetadata";

export const metadata = createMarketingMetadata({
  title: "Privacy Policy",
  description: "Dad Health privacy policy.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <HomepageHeader />
      <main>
        <LegalHero title="Privacy Policy" currentPath="/privacy" />
        <LegalDocument sourceFile="policy.html" />
        <HomepageCrisis />
      </main>
      <HomepageFooter />
    </div>
  );
}
