import Image from "next/image";
import {
  marketingBodyClass,
  marketingContainerClass,
  marketingSectionHeadingClass,
} from "@/components/marketing/marketingStyles";

export default function AboutMiniPartners() {
  return (
    <section className="bg-card text-foreground">
      <div className={`${marketingContainerClass} grid gap-10 py-14 sm:py-16 lg:grid-cols-2 lg:items-center lg:gap-10 lg:py-16 xl:gap-14 min-[1440px]:gap-20 min-[1440px]:py-20`}>
        <div>
          <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">Train Mini Partners</p>
          <h2 className={`mt-5 max-w-xl ${marketingSectionHeadingClass}`}>Train together on Sundays</h2>
          <p className={`mt-6 max-w-xl ${marketingBodyClass}`}>Hyrox-style parent and child workouts at Train, powered by Dad Health.</p>
        </div>
  <div className="relative mx-auto aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-muted shadow-[0_0_20px_hsl(var(--primary)/0.04)] lg:justify-self-end">
  <Image
    src="/mini-partners.jpg"
    alt="A dad carrying his child during a Mini Partners training session"
    fill
    sizes="(max-width: 1023px) calc(100vw - 2.5rem), 50vw"
    className="object-cover object-[50%_35%]"
  />
</div>
      </div>
    </section>
  );
}
