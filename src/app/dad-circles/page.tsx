import HomepageHeader from "@/components/homepage/HomepageHeader";
import HomepageCrisis from "@/components/homepage/HomepageCrisis";
import HomepageFooter from "@/components/homepage/HomepageFooter";
import CommunityHero from "@/components/communitypage/CommunityHero";
import CommunityCircles from "@/components/communitypage/CommunityCircles";
import CommunityHowItWorks from "@/components/communitypage/CommunityHowItWorks";
import CommunityTopics from "@/components/communitypage/CommunityTopics";
import CommunityDownload from "@/components/communitypage/CommunityDownload";
import { createMarketingMetadata } from "@/lib/marketingMetadata";

export const metadata = createMarketingMetadata({
  title: "Dad Circles",
  description: "Find dads going through the same chapter as you in Dad Health Community.",
  path: "/dad-circles",
});

export default function DadCirclesPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <HomepageHeader />
      <main>
        <CommunityHero />
        <CommunityCircles />
        <CommunityHowItWorks />
        <CommunityTopics topics={[]} />
        <CommunityDownload />
        <HomepageCrisis />
      </main>
      <HomepageFooter />
    </div>
  );
}
