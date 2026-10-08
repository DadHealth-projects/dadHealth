import {
  marketingContainerClass,
  marketingSectionHeadingClass,
} from "@/components/marketing/marketingStyles";

export default function HowItWorksLogging() {
  return (
    <section className="bg-primary text-primary-foreground">
      <div className={`${marketingContainerClass} grid gap-7 py-14 sm:py-16 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-center lg:gap-10 lg:py-16 xl:grid-cols-[minmax(0,1fr)_22rem] min-[1440px]:grid-cols-[minmax(0,1fr)_25rem] min-[1440px]:gap-16 min-[1440px]:py-20`}>
        <h2 className={`${marketingSectionHeadingClass} leading-[0.9]`}>
          Log anything.<br />It all counts.
        </h2>
        <p className="max-w-xl text-[15px] leading-relaxed sm:text-base">
          You do not have to use Dad Health workouts to score well. Log what you actually did across Mind, Body and Bond for free, including activity from the previous seven days.
        </p>
      </div>
    </section>
  );
}
