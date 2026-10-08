import { homepagePrimaryButtonClass } from "@/components/homepage/HomepagePrimaryButton";
import {
  marketingArrowClass,
  marketingBodyClass,
  marketingSectionClass,
  marketingSectionHeadingClass,
} from "@/components/marketing/marketingStyles";

export default function SupportStillStuck() {
  return (
    <section className="bg-background text-foreground">
      <div className={marketingSectionClass}>
        <h2 className={marketingSectionHeadingClass}>Still stuck?</h2>
        <p className={`mt-5 ${marketingBodyClass}`}>Email us and we will come back to you.</p>
        <a
          href="mailto:hello@dadhealth.co.uk"
          className={`${homepagePrimaryButtonClass} mt-7`}
        >
          Email support <span aria-hidden="true" className={marketingArrowClass}>&rarr;</span>
        </a>
      </div>
    </section>
  );
}
