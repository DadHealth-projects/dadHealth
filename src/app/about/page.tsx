import AboutBeliefs from "@/components/aboutpage/AboutBeliefs";
import AboutCompanyContact from "@/components/aboutpage/AboutCompanyContact";
import AboutDownload from "@/components/aboutpage/AboutDownload";
import AboutFounder from "@/components/aboutpage/AboutFounder";
import AboutHero from "@/components/aboutpage/AboutHero";
import AboutMiniPartners from "@/components/aboutpage/AboutMiniPartners";
import HomepageCrisis from "@/components/homepage/HomepageCrisis";
import HomepageFooter from "@/components/homepage/HomepageFooter";
import HomepageHeader from "@/components/homepage/HomepageHeader";
import { createMarketingMetadata } from "@/lib/marketingMetadata";

export const metadata = createMarketingMetadata({
  title: "About",
  description: "Dad Health is a mental health, fitness and parenting app built for dads, by dads.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <HomepageHeader />
      <main>
        <AboutHero />
        <AboutFounder />
        <AboutBeliefs />
        <AboutMiniPartners />
        <AboutCompanyContact />
        <AboutDownload />
        <HomepageCrisis />
      </main>
      <HomepageFooter />
    </div>
  );
}
