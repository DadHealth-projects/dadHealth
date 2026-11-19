import Link from "next/link";
import { marketingSectionClass, marketingSectionHeadingClass } from "@/components/marketing/marketingStyles";

export default function HomepagePrivacy() {
  return (
    <section className="bg-background text-foreground">
      <div className={marketingSectionClass}>
        <h2 className={marketingSectionHeadingClass}>Your wellbeing. Your space.</h2>
        <div className="mt-5 max-w-2xl space-y-4 text-base leading-relaxed text-muted-foreground">
          <p>Your Journal and mental wellbeing check-ins are saved to your account, not posted to the community. Your scores help you follow your progress.</p>
          <p>What you choose to post in Dad Circles is shared with the community. Our privacy policy explains how account information is stored, used and handled by our service providers.</p>
          <Link href="/privacy" className="inline-flex min-h-11 items-center text-foreground underline decoration-primary underline-offset-4">Read our privacy policy</Link>
        </div>
      </div>
    </section>
  );
}
