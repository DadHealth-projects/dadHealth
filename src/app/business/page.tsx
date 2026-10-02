import BusinessBenefits from "@/components/business/BusinessBenefits";
import BusinessBranding from "@/components/business/BusinessBranding";
import BusinessHeader from "@/components/business/BusinessHeader";
import BusinessHero from "@/components/business/BusinessHero";
import BusinessHowItWorks from "@/components/business/BusinessHowItWorks";
import BusinessLeavers from "@/components/business/BusinessLeavers";
import BusinessPricing from "@/components/business/BusinessPricing";
import BusinessPrivacy from "@/components/business/BusinessPrivacy";
import BusinessEnquiry from "@/components/business/BusinessEnquiry";
import HomepageCrisis from "@/components/homepage/HomepageCrisis";
import HomepageFooter from "@/components/homepage/HomepageFooter";
import { createMarketingMetadata } from "@/lib/marketingMetadata";

export const metadata = createMarketingMetadata({
  title: "Dad Health for Business | Support the dads on your team",
  description: "Dad Health for Business gives your working dads Pro access to a mental health, fitness and parenting app, with anonymous team insights for HR. Your own branded version for 100+ eligible sign-ups.",
  path: "/business",
  absoluteTitle: true,
});

export default function BusinessPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <BusinessHeader />
      <main>
        <BusinessHero />
        <BusinessBenefits />
        <BusinessPrivacy />
        <BusinessBranding />
        <BusinessHowItWorks />
        <BusinessLeavers />
        <BusinessPricing />
        <BusinessEnquiry />
        <HomepageCrisis />
      </main>
      <HomepageFooter />
    </div>
  );
}
