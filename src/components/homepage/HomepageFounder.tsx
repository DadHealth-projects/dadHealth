import Link from "next/link";
import Image from "next/image";

export default function HomepageFounder() {
  return (
    <section id="about" className="scroll-mt-14 border-y border-border bg-card text-foreground">
      <div className="mx-auto grid max-w-7xl gap-7 px-5 py-10 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center sm:px-6 sm:py-12 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10 lg:px-8 lg:py-14">
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-border bg-background shadow-[0_0_18px_hsl(var(--primary)/0.04)] sm:aspect-[3/4]">
          <Image
            src="/Home Screen top image.jpg"
            alt="Jamie, founder of Dad Health, training outdoors"
            fill
            loading="eager"
            sizes="(max-width: 639px) calc(100vw - 2.5rem), 14rem"
            className="object-cover object-center"
          />
        </div>

        <div className="max-w-2xl">
          <p className="font-heading text-[13px] font-bold uppercase tracking-[0.3em] text-primary sm:text-sm lg:text-base">From our founder</p>
          <h2 className="mt-3 font-heading text-[2rem] font-extrabold uppercase leading-none sm:text-4xl lg:text-5xl min-[1440px]:text-[3.25rem]">
            Built by a dad who&apos;s been there
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground sm:text-lg">
            Five years ago I was obese, drinking most days, and carrying mental health struggles I&apos;d never dealt with. I swore I wouldn&apos;t be a dad who couldn&apos;t keep up with his kid, in body or in mind.
          </p>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground sm:text-lg">
            I got myself together through grit and determination, with nothing built for a dad like me. Dad Health is what I wish I&apos;d had.
          </p>
          <Link
            href="/about"
            className="mt-5 inline-flex min-h-11 items-center rounded-md font-heading text-[15px] font-extrabold uppercase tracking-[0.1em] text-primary transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-base"
          >
            Read my story <span aria-hidden="true" className="ml-2">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
