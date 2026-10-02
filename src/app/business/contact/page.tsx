import type { Metadata } from "next";
import BusinessEnquiry from "@/components/business/BusinessEnquiry";
import BusinessHeader from "@/components/business/BusinessHeader";
import HomepageCrisis from "@/components/homepage/HomepageCrisis";
import HomepageFooter from "@/components/homepage/HomepageFooter";

export const metadata: Metadata = {
  title: "Talk to Dad Health for Business",
  description: "Tell us about your organisation and enquire about Dad Health for Business.",
};

export default function BusinessContactPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <BusinessHeader />
      <main>
        <BusinessEnquiry />
        <HomepageCrisis />
      </main>
      <HomepageFooter />
    </div>
  );
}
