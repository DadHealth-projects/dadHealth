import HomepagePrimaryButton from "@/components/homepage/HomepagePrimaryButton";
import {
  marketingArrowClass,
  marketingSectionClass,
  marketingSectionHeadingClass,
} from "@/components/marketing/marketingStyles";

export default function AboutDownload() {
  return (
    <section id="download" className="scroll-mt-14 bg-card text-foreground">
      <div className={marketingSectionClass}>
        <h2 className={marketingSectionHeadingClass}>Join the waitlist.</h2>
        <HomepagePrimaryButton href="/waitlist" className="mt-7">
          Join the waitlist <span aria-hidden="true" className={marketingArrowClass}>→</span>
        </HomepagePrimaryButton>
      </div>
    </section>
  );
}
