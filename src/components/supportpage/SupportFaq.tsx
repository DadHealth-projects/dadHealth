import {
  marketingBodyClass,
  marketingSectionClass,
  marketingSectionHeadingClass,
} from "@/components/marketing/marketingStyles";

const questions = [
  {
    question: "Is Dad Health free?",
    answer: "Yes. Free is permanent, not a trial. The score, check-in, breathing, Journal, crisis support and logging are free. Pro is £49.99/year.",
  },
  {
    question: "How do I log a workout that is not in the app?",
    answer: "Open Body, tap Log, choose an activity, add a duration and intensity. You can backdate up to 7 days.",
  },
  {
    question: "Is my Journal private?",
    answer: "Yes. Your Journal and check-ins are yours.",
  },
  {
    question: "Can my employer see my data?",
    answer: "No. Employers only ever see anonymous group data, never an individual’s check-ins, scores or logs.",
  },
  {
    question: "I am struggling. Who can I talk to?",
    answer: "Call Samaritans free on 116 123, any time. In an emergency, call 999.",
  },
  {
    question: "Something is not working",
    answer: "Email hello@dadhealth.co.uk with your phone model and what happened. A screen recording helps.",
  },
];

export default function SupportFaq() {
  return (
    <section className="bg-card text-foreground">
      <div className={marketingSectionClass}>
        <h2 className={marketingSectionHeadingClass}>Common questions</h2>
        <div className="mt-8">
          {questions.map((item) => (
            <article key={item.question} className="grid gap-3 border-t border-border py-7 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12">
              <h3 className="max-w-xl font-heading text-2xl font-extrabold uppercase leading-none sm:text-3xl">{item.question}</h3>
              <p className={`max-w-2xl ${marketingBodyClass}`}>{item.answer}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
