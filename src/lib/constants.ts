export const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Fitness", href: "/fitness" },
  { label: "Mind", href: "/mind" },
  { label: "Bond", href: "/bond" },
  { label: "Community", href: "/community" },
  { label: "Progress", href: "/progress" },
  { label: "Pricing", href: "/pricing" },
] as const;

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
