export default function AboutFounder() {
  return (
    <section className="bg-card text-foreground">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-start lg:gap-12 lg:px-8 lg:py-16 xl:gap-16 xl:py-20 min-[1440px]:gap-20 min-[1440px]:py-24">
        <div className="flex aspect-[4/5] min-h-72 items-center justify-center rounded-2xl border border-border bg-muted p-8 text-center shadow-[0_0_20px_hsl(var(--primary)/0.04)] sm:min-h-96 lg:min-h-0">
          <p className="max-w-xs text-sm text-muted-foreground">Jamie&rsquo;s founder photo is pending.</p>
        </div>
        <article className="max-w-2xl">
          <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-primary sm:text-sm">From Jamie, founder</p>
          <h2 className="mt-5 font-heading text-5xl font-extrabold uppercase leading-none tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">Why I built Dad Health</h2>
          <div className="mt-7 space-y-5 text-base leading-relaxed text-muted-foreground">
            <p>I&apos;m Jamie, and I&apos;m a dad.</p>
            <p>Five years ago I wasn&apos;t looking after myself. I was obese, drinking most days, and I had no real idea how to look after my body or my head. I had mental health struggles I&apos;d never dealt with. I trained now and then, but I couldn&apos;t stay consistent, and the snooze button usually won.</p>
            <p>I used to take my son out on his lunchtime walk so he&apos;d nod off in the pram. The moment he was asleep, I&apos;d head straight to the pub.</p>
            <p>When I went looking for answers, I did what most of us do and turned to social media. I&apos;d scroll endlessly, searching for something that would help, and end up in a worse place than where I started. Everyone seemed to have it sorted, and none of them had been where I was.</p>
            <p>Then I started noticing other parents who couldn&apos;t keep up with their kids, physically or mentally. I swore that wouldn&apos;t be me. I wanted my son to grow up with a dad who was an example, strong in body and in mind.</p>
            <p>So I faced it. I got myself together through my own grit and determination, with no roadmap and nothing built for a dad in my position.</p>
            <p>Once I&apos;d come out the other side, I knew who I wanted to build for: the dad I was five years ago.</p>
            <p>That&apos;s Dad Health. It looks at your <span className="font-semibold text-foreground">Mind</span>, <span className="font-semibold text-foreground">Body</span> and <span className="font-semibold text-foreground">Bond</span> together, because they pull on each other. Your Dad Health Score shows how you&apos;re really doing, and each day gives you one simple thing to do next, not a list. It counts the training you do anywhere, the bedtime routine, and the call to a mate when things are heavy.</p>
            <p>I also built it so you don&apos;t have to put up with the social media onslaught of trying to keep up with people who have never been through what we have. Dad Health is made for dads who know that road, so you can focus on your own progress, not anyone else&apos;s highlights.</p>
            <p>And it&apos;s for every kind of dad. New dads and old dads. Anyone who steps up as a father figure in someone&apos;s life. Dads in a relationship, and single dads starting a new chapter and working out how to do it on their own. However you got here, you belong here.</p>
            <p>I&apos;m not here to tell you to be perfect. I&apos;m here because I know where you might be starting from, and I know it&apos;s possible to change. You don&apos;t have to do it alone.</p>
          </div>
          <div className="mt-8 border-l-2 border-primary pl-5">
            <p className="font-heading text-xl font-extrabold uppercase text-foreground">Jamie Smith</p>
            <p className="mt-1 text-sm text-muted-foreground">Founder, Dad Health</p>
          </div>
        </article>
      </div>
    </section>
  );
}
