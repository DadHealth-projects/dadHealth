import {
  marketingCardSurfaceClass,
  marketingSectionClass,
  marketingSectionHeadingClass,
} from "@/components/marketing/marketingStyles";

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
      <div className={marketingSectionClass}>
        <h2 className={`${marketingSectionHeadingClass} leading-[0.9]`}>
          What dads are talking about
        </h2>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {approvedTopics.map((topic) => (
            <article key={topic.id} className={`${marketingCardSurfaceClass} p-5 sm:p-7`}>
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
