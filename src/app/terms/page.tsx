import HomepageCrisis from "@/components/homepage/HomepageCrisis";
import HomepageFooter from "@/components/homepage/HomepageFooter";
import HomepageHeader from "@/components/homepage/HomepageHeader";
import LegalDocument from "@/components/legal/LegalDocument";
import LegalHero from "@/components/legal/LegalHero";
import { createMarketingMetadata } from "@/lib/marketingMetadata";

export const metadata = createMarketingMetadata({
  title: "Terms and Conditions",
  description: "Dad Health terms and conditions and legal terms.",
  path: "/terms",
});

export default function TermsPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <HomepageHeader />
      <main>
        <LegalHero title="Terms and Conditions" currentPath="/terms" />
        <LegalDocument sourceFile="terms.html" />
        <HomepageCrisis />
      </main>
      <HomepageFooter />
    </div>
  );
}
