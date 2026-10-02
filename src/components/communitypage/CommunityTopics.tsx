export interface CommunityTopic {
  id: string;
  prompt: string;
}

interface CommunityTopicsProps {
  topics: CommunityTopic[];
}

export default function CommunityTopics({ topics }: CommunityTopicsProps) {
  const approvedTopics = topics.filter((topic) => topic.prompt.trim()).slice(0, 3);

  if (approvedTopics.length === 0) return null;

  return (
    <section className="bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-16 xl:py-20 min-[1440px]:py-24">
        <h2 className="font-heading text-5xl font-extrabold uppercase leading-[0.9] tracking-[-0.025em] sm:text-6xl lg:text-5xl xl:text-[3.25rem] min-[1440px]:text-6xl">
          What dads are talking about
        </h2>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {approvedTopics.map((topic) => (
            <article key={topic.id} className="bg-card p-6 sm:p-8">
              <p className="font-heading text-xs font-bold uppercase tracking-[0.22em] text-primary">
                Dad Health · Official prompt
              </p>
              <p className="mt-5 text-base leading-relaxed text-foreground">{topic.prompt}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
