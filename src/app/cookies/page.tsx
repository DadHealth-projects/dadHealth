import HomepageCrisis from "@/components/homepage/HomepageCrisis";
import HomepageFooter from "@/components/homepage/HomepageFooter";
import HomepageHeader from "@/components/homepage/HomepageHeader";
import LegalDocument from "@/components/legal/LegalDocument";
import LegalHero from "@/components/legal/LegalHero";
import { createMarketingMetadata } from "@/lib/marketingMetadata";

export const metadata = createMarketingMetadata({
  title: "Cookie Policy",
  description: "Dad Health cookie policy.",
  path: "/cookies",
});

export default function CookiesPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <HomepageHeader />
      <main>
        <LegalHero title="Cookie Policy" currentPath="/cookies" />
        <LegalDocument sourceFile="cookies.html" />
        <HomepageCrisis />
      </main>
      <HomepageFooter />
    </div>
  );
}
