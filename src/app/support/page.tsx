import HomepageCrisis from "@/components/homepage/HomepageCrisis";
import HomepageFooter from "@/components/homepage/HomepageFooter";
import HomepageHeader from "@/components/homepage/HomepageHeader";
import SupportContactCards from "@/components/supportpage/SupportContactCards";
import SupportFaq from "@/components/supportpage/SupportFaq";
import SupportHero from "@/components/supportpage/SupportHero";
import SupportStillStuck from "@/components/supportpage/SupportStillStuck";
import { createMarketingMetadata } from "@/lib/marketingMetadata";

export const metadata = createMarketingMetadata({
  title: "Support",
  description: "Get help with Dad Health, report a problem or find crisis support.",
  path: "/support",
});

export default function SupportPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <HomepageHeader />
      <main>
        <SupportHero />
        <SupportContactCards />
        <SupportFaq />
        <SupportStillStuck />
        <HomepageCrisis />
      </main>
      <HomepageFooter />
    </div>
  );
}
