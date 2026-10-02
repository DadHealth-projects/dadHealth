import StoreDownloadButtons from "@/components/marketing/StoreDownloadButtons";

export default function AboutDownload() {
  return (
    <section id="download" className="scroll-mt-14 bg-card text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <h2 className="font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.5rem] min-[1440px]:text-7xl">Get the app.</h2>
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground sm:text-base">Free on iPhone and Android. Pro when you want it personal.</p>
        <StoreDownloadButtons />
      </div>
    </section>
  );
}
