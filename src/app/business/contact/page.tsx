import { createMarketingMetadata } from "@/lib/marketingMetadata";
import BusinessEnquiry from "@/components/business/BusinessEnquiry";
import BusinessHeader from "@/components/business/BusinessHeader";
import HomepageCrisis from "@/components/homepage/HomepageCrisis";
import HomepageFooter from "@/components/homepage/HomepageFooter";

export const metadata = createMarketingMetadata({
  title: "Talk to Dad Health for Business",
  description: "Tell us about your organisation and enquire about Dad Health for Business.",
  path: "/business/contact",
});

export default function BusinessContactPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <BusinessHeader />
      <main>
        <BusinessEnquiry headingLevel="h1" />
        <HomepageCrisis />
      </main>
      <HomepageFooter />
    </div>
  );
}
