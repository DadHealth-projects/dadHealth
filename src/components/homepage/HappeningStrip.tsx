import Image from "next/image";
import type { HomepageHappening } from "@/lib/happenings";

interface HappeningStripProps {
  items: HomepageHappening[];
}

function isLive(item: HomepageHappening, now: number) {
  const eventTime = Date.parse(item.event_at);
  const expiry = Date.parse(item.show_until);
  return item.active && Number.isFinite(eventTime) && Number.isFinite(expiry) && expiry > now;
}

function EventDate({ value }: { value: string }) {
  const date = new Date(value);

  return (
    <time dateTime={value} className="flex flex-col items-center font-heading font-extrabold uppercase leading-none">
      <span className="text-xs">
        {date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "Europe/London" })}
      </span>
      <span className="my-1 text-3xl">
        {date.toLocaleDateString("en-GB", { day: "numeric", timeZone: "Europe/London" })}
      </span>
      <span className="text-xs">
        {date.toLocaleDateString("en-GB", { month: "short", timeZone: "Europe/London" })}
      </span>
    </time>
  );
}

export default function HappeningStrip({ items }: HappeningStripProps) {
  const liveItems = items
    .filter((item) => isLive(item, Date.now()))
    .sort((a, b) => Date.parse(a.event_at) - Date.parse(b.event_at))
    .slice(0, 3);

  if (liveItems.length === 0) return null;

  return (
    <section aria-labelledby="happening-title" className="border-y border-border bg-card text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 sm:px-6 lg:flex-row lg:items-center lg:gap-5 lg:px-8 xl:gap-6 min-[1440px]:gap-8">
        <div className="shrink-0 lg:w-36 xl:w-40 min-[1440px]:w-44">
          <h2 id="happening-title" className="flex items-center gap-3 font-heading text-xs font-bold uppercase tracking-[0.28em] text-primary">
            <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
            Happening
          </h2>
          <p className="mt-3 max-w-40 text-xs leading-relaxed text-muted-foreground">Only shows when there is something on.</p>
        </div>

        <div className="grid flex-1 gap-4">
          {liveItems.map((item) => (
            <article key={item.id} className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-5 shadow-[0_0_18px_hsl(var(--primary)/0.04)] sm:flex-row sm:items-center">
              <div className="flex w-full gap-3 sm:w-auto">
                <div className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <EventDate value={item.event_at} />
                </div>
                {item.image_url && (
                  <Image
                    src={item.image_url}
                    alt=""
                    width={320}
                    height={200}
                    sizes="(min-width: 640px) 128px, calc(100vw - 148px)"
                    className="h-20 min-w-0 flex-1 rounded-xl object-cover sm:w-32 sm:flex-none"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-heading text-2xl font-extrabold uppercase leading-none lg:text-xl xl:text-[1.35rem] min-[1440px]:text-2xl">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{item.summary}</p>
              </div>
              {item.button_label && item.button_url && (
                <a
                  href={item.button_url}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-primary bg-primary px-5 font-heading text-sm font-extrabold uppercase tracking-[0.08em] text-primary-foreground shadow-[0_0_18px_hsl(var(--primary)/0.10)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {item.button_label} <span aria-hidden="true" className="ml-2">→</span>
                </a>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
