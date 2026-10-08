import HomepagePrimaryButton from "@/components/homepage/HomepagePrimaryButton";
import {
  marketingArrowClass,
  marketingBodyClass,
  marketingSectionClass,
  marketingSectionHeadingClass,
} from "@/components/marketing/marketingStyles";

export default function CommunityDownload() {
  return (
    <section id="download" className="scroll-mt-14 bg-card text-foreground">
      <div className={marketingSectionClass}>
        <h2 className={marketingSectionHeadingClass}>
          Join a Circle.
        </h2>
        <p className={`mt-5 ${marketingBodyClass}`}>
          Full Community access is Free.
        </p>
        <HomepagePrimaryButton href="/waitlist" className="mt-7">
          Join the waitlist <span aria-hidden="true" className={marketingArrowClass}>→</span>
        </HomepagePrimaryButton>
      </div>
    </section>
  );
}
