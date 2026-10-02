import HomepageHeader from "@/components/homepage/HomepageHeader";
import HowItWorksHero from "@/components/howitworks/HowItWorksHero";
import HowItWorksScore from "@/components/howitworks/HowItWorksScore";
import HowItWorksPillars from "@/components/howitworks/HowItWorksPillars";
import HowItWorksLogging from "@/components/howitworks/HowItWorksLogging";
import HowItWorksSteps from "@/components/howitworks/HowItWorksSteps";
import HowItWorksDownload from "@/components/howitworks/HowItWorksDownload";
import HomepageCrisis from "@/components/homepage/HomepageCrisis";
import HomepageFooter from "@/components/homepage/HomepageFooter";
import { createMarketingMetadata } from "@/lib/marketingMetadata";

export const metadata = createMarketingMetadata({
  title: "How It Works",
  description:
    "See how the Dad Health Score brings Mind, Body and Bond together and gives you one thing to do today.",
  path: "/howitworks",
});

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <HomepageHeader />
      <main>
        <HowItWorksHero />
        <HowItWorksScore />
        <HowItWorksPillars />
        <HowItWorksLogging />
        <HowItWorksSteps />
        <HowItWorksDownload />
        <HomepageCrisis />
      </main>
      <HomepageFooter />
    </div>
  );
}
