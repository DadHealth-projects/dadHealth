export const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Fitness", href: "/fitness" },
  { label: "Mind", href: "/mind" },
  { label: "Bond", href: "/bond" },
  { label: "Community", href: "/community" },
  { label: "Progress", href: "/progress" },
  { label: "Pricing", href: "/pricing" },
] as const;

/** Subtitle under community post author (role line — not the person’s name). */
export const COMMUNITY_POST_SUBLINE = "Member · ";

export const STATS = [
  { value: "4.2M", label: "UK men with mental health issues" },
  { value: "1 IN 8", label: "Have experienced symptoms" },
  { value: "4 IN 10", label: "Won't discuss it with anyone" },
  { value: "60%", label: "Of adult males obese by 2050" },
] as const;

export const STATS_EXTENDED = [
  { value: "4.2", sub: "MILLION", label: "Men in the UK living with mental health challenges" },
  { value: "60%", sub: "", label: "Of adult males could be classed as obese by 2050" },
  { value: "4 IN 10", sub: "", label: "Men with mental health concerns won't discuss it with anyone" },
  { value: "18%", sub: "", label: "UK Dads doing more childcare since pre-pandemic" },
] as const;

export const PILLARS = [
  {
    tag: "MENTAL HEALTH",
    description: "One of the most commonly avoided conversations for men",
    href: "/mind",
  },
  {
    tag: "FITNESS",
    description: "It is not too late to start, honestly",
    href: "/fitness",
  },
  {
    tag: "NUTRITION",
    description: "Dialling in your nutrition is step one if you want to lose weight",
    href: "/fitness",
  },
  {
    tag: "PARENTING",
    description: "The never-ending challenge of family life, tackled together",
    href: "/bond",
  },
] as const;

export const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
export const BLOCKED_CHECKIN_MOODS = [1, 2, 4] as const;

export const FAQ_ITEMS = [
  {
    q: "Can I cancel anytime?",
    a: "Yes — cancel from your account settings with no questions asked. You keep Pro access until the end of your billing period.",
  },
  {
    q: "Is there really a free trial?",
    a: "7 days full Pro access, no card required. We'll ask for payment details when the trial ends.",
  },
  {
    q: "Is my data private?",
    a: "Your journal, moods and milestones are private by default. We never sell your data. Crisis support is always accessible without logging in.",
  },
  {
    q: "What's included in the Business plan?",
    a: "Everything in Pro, plus a company dashboard, bulk licence invoicing, HR integration support, optional branding, and a dedicated account manager.",
  },
  {
    q: "Do you have a native app?",
    a: "We're launching as a web app first. Native iOS and Android apps are on the roadmap - sign up to be notified when they launch.",
  },
] as const;

export const PRICING_PLANS = [
  {
    name: "FREE",
    price: "£0",
    sub: "Forever free",
    features: [
      "Daily mood check-in",
      "3-question CBT pulse",
      "Dad Health Score with Mind, Body and Bond",
      "Workout library",
      "Journal and breathing exercises",
      "Therapist and counsellor directory",
      "Milestone logging",
      "Community (free for all dads)",
      "Crisis support (always)",
    ],
    excluded: [
      "AI workouts and meal plans",
      "Weekly score trends and insights",
      "Mood trend graphs",
      "Weekly and monthly reports",
    ],
    cta: "CURRENT PLAN",
  },
  {
    name: "PRO",
    price: "£4.17",
    sub: "per month · billed £49.99/year",
    badge: "SAVE £33",
    popular: true,
    features: [
      "Everything in Free",
      "AI workouts built around your day",
      "AI meal planner + shopping list",
      "Full TDEE calorie targets and insights",
      "Weekly score trends and pillar insights",
      "Mood & sleep trend graphs",
      "Weekly Dad Health report + monthly summary",
      "Milestone photo uploads",
      "Unlimited Dad Days search",
    ],
    cta: "START 7-DAY FREE TRIAL →",
  },
  {
    name: "BUSINESS",
    price: "£6",
    sub: "per employee / month · min 10 seats",
    features: [
      "Everything in Pro",
      "Company dashboard",
      "Usage & wellbeing reports",
      "Custom branding option",
      "Bulk licence invoicing",
      "Dedicated account manager",
      "HR integration support",
      "Priority support",
      "Quarterly business review",
    ],
    cta: "CONTACT US →",
  },
] as const;

export const TESTIMONIALS = [
  {
    text: "\"The meal planner alone is worth it. My wife actually thinks I know what I'm doing now.\"",
    name: "MARCUS, 34 · DAD HEALTH PRO",
  },
  {
    text: "\"The mood graph showed me I was 60% worse on Mondays. Simple fix — protect Sunday evenings.\"",
    name: "TOM, 41 · DAD HEALTH PRO",
  },
  {
    text: "\"First app actually built for dads. Not a watered-down fitness app. The real thing.\"",
    name: "DAN, 38 · DAD HEALTH PRO",
  },
] as const;

export const FOOTER_LINKS = {
  platform: [
    { label: "Home", href: "/" },
    { label: "Fitness", href: "/fitness" },
    { label: "Mental health", href: "/mind" },
    { label: "Bond", href: "/bond" },
    { label: "Community", href: "/community" },
    { label: "Progress", href: "/progress" },
  ],
  company: [
    { label: "About us", href: "#" },
    { label: "Pricing", href: "/pricing" },
    { label: "Blog", href: "#" },
    { label: "Contact", href: "#" },
  ],
  legal: [
    { label: "Privacy policy", href: "/privacy" },
    { label: "Terms and conditions", href: "/terms" },
    { label: "EULA", href: "/eula" },
    { label: "Cookie settings", href: "/cookies" },
  ],
} as const;
