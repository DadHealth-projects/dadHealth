import HomepageCrisis from "@/components/homepage/HomepageCrisis";
import HomepageFooter from "@/components/homepage/HomepageFooter";
import HomepageHeader from "@/components/homepage/HomepageHeader";
import HomepageWaitlist from "@/components/homepage/HomepageWaitlist";
import { createMarketingMetadata } from "@/lib/marketingMetadata";

export const metadata = createMarketingMetadata({
  title: "Join the Waitlist",
  description: "Join the Dad Health waitlist.",
  path: "/waitlist",
});

export default function WaitlistPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <HomepageHeader />
      <main>
        <HomepageWaitlist headingLevel="h1" />
        <HomepageCrisis />
      </main>
      <HomepageFooter />
    </div>
  );
}
