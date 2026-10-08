
import type { Metadata } from "next";
import HomepageFooter from "@/components/homepage/HomepageFooter";
import HomepageHeader from "@/components/homepage/HomepageHeader";
import PrivacyRequestForm from "@/components/privacyrequest/PrivacyRequestForm";
import { createMarketingMetadata } from "@/lib/marketingMetadata";

const baseMetadata = createMarketingMetadata({
  title: "Privacy Request",
  description:
    "Contact Dad Health about access, correction, deletion or another privacy enquiry.",
  path: "/privacy-request",
});

export const metadata: Metadata = {
  ...baseMetadata,
  robots: {
    index: false,
    follow: false,
  },
};

export default function PrivacyRequestPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <HomepageHeader />

      <main>
        <PrivacyRequestForm />
      </main>

      <HomepageFooter />
    </div>
  );
}