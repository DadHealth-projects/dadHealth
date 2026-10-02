import HomepageHeader from "@/components/homepage/HomepageHeader";
import FreeProHero from "@/components/freepro/FreeProHero";
import FreeProPlanCards from "@/components/freepro/FreeProPlanCards";
import FreeProComparison from "@/components/freepro/FreeProComparison";
import FreeProFaq from "@/components/freepro/FreeProFaq";
import FreeProDownload from "@/components/freepro/FreeProDownload";
import HomepageCrisis from "@/components/homepage/HomepageCrisis";
import HomepageFooter from "@/components/homepage/HomepageFooter";
import { createMarketingMetadata } from "@/lib/marketingMetadata";

export const metadata = createMarketingMetadata({
  title: "Free & Pro",
  description:
    "Dad Health is free forever, with Pro available for deeper insights and personalised Body features.",
  path: "/free-and-pro",
});

export default function FreeAndProPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <HomepageHeader />
      <main>
        <FreeProHero />
        <FreeProPlanCards />
        <FreeProComparison />
        <FreeProFaq />
        <FreeProDownload />
        <HomepageCrisis />
      </main>
      <HomepageFooter />
    </div>
  );
}
