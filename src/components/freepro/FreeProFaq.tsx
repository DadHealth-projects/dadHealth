import {
  marketingBodyClass,
  marketingSectionClass,
  marketingSectionHeadingClass,
} from "@/components/marketing/marketingStyles";

const questions = [
  {
    question: "Is Free really free?",
    answer:
      "Yes. Free is permanent, not a trial. It includes the Dad Health Score, current pillar trends, daily check-in, core Mind support, basic workouts, manual logging, Community and three Dad Days searches each month.",
  },
  {
    question: "What does Pro cost?",
    answer:
      "£6.99/month or £49.99/year. Pro adds deeper history and insights, personalised Body functionality and AI workouts, Meal Planner, unlimited Dad Days, reports and one streak freeze each week.",
  },
  {
    question: "Can my employer give me Pro?",
    answer:
      "Dad Health for Business can provide Pro as a staff benefit. Employers never see an individual dad’s check-ins, mood, Journal, scores or activity logs.",
  },
];

export default function FreeProFaq() {
  return (
    <section className="bg-background text-foreground">
      <div className={marketingSectionClass}>
        <h2 className={marketingSectionHeadingClass}>
          Questions
        </h2>

        <div className="mt-10 grid gap-x-12 lg:grid-cols-2">
          {questions.map((item) => (
            <article key={item.question} className="border-t border-border py-6">
              <h3 className="font-heading text-2xl font-extrabold uppercase leading-none sm:text-3xl">
                {item.question}
              </h3>
              <p className={`mt-3 max-w-xl ${marketingBodyClass}`}>
                {item.answer}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
