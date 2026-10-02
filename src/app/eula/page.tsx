import HomepageCrisis from "@/components/homepage/HomepageCrisis";
import HomepageFooter from "@/components/homepage/HomepageFooter";
import HomepageHeader from "@/components/homepage/HomepageHeader";
import LegalDocument from "@/components/legal/LegalDocument";
import LegalHero from "@/components/legal/LegalHero";
import { createMarketingMetadata } from "@/lib/marketingMetadata";

export const metadata = createMarketingMetadata({
  title: "End User Licence Agreement",
  description: "Dad Health end user licence agreement (EULA).",
  path: "/eula",
});

export default function EulaPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <HomepageHeader />
      <main>
        <LegalHero title="End User Licence Agreement" currentPath="/eula" />
        <LegalDocument sourceFile="EULA.html" />
        <HomepageCrisis />
      </main>
      <HomepageFooter />
    </div>
  );
}
