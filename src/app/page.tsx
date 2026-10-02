import HomepageHeader from "@/components/homepage/HomepageHeader";
import HomepageHero from "@/components/homepage/HomepageHero";
import HomepageHowItWorks from "@/components/homepage/HomepageHowItWorks";
import HappeningStrip from "@/components/homepage/HappeningStrip";
import HomepagePlans from "@/components/homepage/HomepagePlans";
import HomepageCircles from "@/components/homepage/HomepageCircles";
import HomepageFounder from "@/components/homepage/HomepageFounder";
import HomepageFinalCta from "@/components/homepage/HomepageFinalCta";
import HomepageCrisis from "@/components/homepage/HomepageCrisis";
import HomepageFooter from "@/components/homepage/HomepageFooter";
import { getLiveHappenings } from "@/lib/happenings";
import { createMarketingMetadata } from "@/lib/marketingMetadata";

export const metadata = createMarketingMetadata({
  title: "Dad Health | How are you doing, Dad?",
  description:
    "One score for your Mind, Body and Bond. One thing to do today. Dad Health is built for dads.",
  path: "/",
  absoluteTitle: true,
});

export const dynamic = "force-dynamic";

export default async function Homepage() {
  const happenings = await getLiveHappenings();

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <HomepageHeader />
      <main>
        <HomepageHero />
        <HomepageFounder />
        <HomepageHowItWorks />
        <HappeningStrip items={happenings} />
        <HomepagePlans />
        <HomepageCircles />
        <HomepageFinalCta />
        <HomepageCrisis />
      </main>
      <HomepageFooter />
    </div>
  );
}
