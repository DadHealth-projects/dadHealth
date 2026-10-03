# Dad Health --- Web / Backend Working Rules
## Purpose
This repository contains two different things:
1. The public Dad Health website and legacy web UI.
2. Shared backend infrastructure used by both the website and the
native Dad Health mobile app.
These must never be treated as the same scope.
The public website UI can be replaced or removed when approved.
The shared backend must remain stable unless a task explicitly requires
a backend change.
---
# Source of truth
Before implementing product work:
1. Read the relevant files in `/product`.
2. Prefer the newest approved brief/addendum over older requirements.
3. Later confirmed Jamie decisions override earlier briefs.
4. Do not restore deprecated functionality because it still exists in
old code.
5. Do not infer new product behaviour when the product documents leave
a decision unresolved.
For the website revamp, use the latest revised website brief, supplied
HTML/mockups and approved product decisions.
---
# Critical architecture boundary
The native mobile app is a separate client but depends heavily on this
repository.
The mobile app shares:
- the same Supabase project;
- database tables;
- RLS policies;
- views;
- RPCs/functions;
- score calculations;
- subscription entitlement logic;
- backend API routes hosted by this web app.
Therefore:
> Removing an old web screen does NOT mean its backend/data
infrastructure can be deleted.
Always separate:
## Replaceable web presentation
Examples:
- public homepage sections;
- legacy web dashboard UI;
- old Mind / Body / Bond / Progress presentation;
- old pricing page presentation;
- public navigation;
- marketing copy;
- website-only layout/components.
## Protected shared infrastructure
Do not delete, rewrite, move or simplify these unless the task
explicitly requires it and dependencies have been reviewed:
- `/supabase/migrations`
- `/supabase/schema.sql`
- RLS policies
- database functions/RPCs
- canonical Dad Health Score calculations/views
- `/src/app/api/**`
- native subscription verification/status/manage logic
- Apple subscription backend
- Google Play subscription backend
- Google RTDN handling
- Stripe backend/webhooks
- authentication/account backend
- biometric/device authentication
- notification backend
- OneSignal backend integration
- AI workout generation
- meal-plan generation
- Dad Days API
- Pro insights API
- profile/milestone upload APIs
- Admin backend/resources
- any service or utility consumed by the native app
Never assume code is unused because the website no longer links to it.
---
# Mobile dependency rule
Before removing shared logic, search the native mobile repository:
`E:\client{=tex}-projects\dadhealth{=tex}-mobile`
Check whether mobile:
- calls the API route;
- reads/writes the Supabase table/view;
- invokes the RPC;
- depends on the auth/subscription result;
- expects the response contract.
If mobile depends on it, preserve it unless the approved task explicitly
changes that contract.
The website UI is NOT the source of truth for mobile features.
Backend contracts and approved product rules are the source of truth.
---
# Current website status --- October 2026
The approved website revamp has now been substantially implemented.
Treat the current live/revamped website as the implementation baseline.
Do not rebuild completed revamp work simply because older /product
documents describe it as future work.
Current state:
- the new public marketing website structure has been implemented;
- the homepage and main public pages have been revamped;
- the Business / Corporate page has been implemented;
- Support, Privacy and Terms pages have been implemented;
- the Happening/Admin capability has been implemented;
- legacy/shared backend infrastructure remains protected;
- remaining revamp work is limited to confirmed bugs, small approved
  tweaks, launch/SEO work, and items blocked on Jamie-provided
  content/assets/decisions.
Known external/pending items must not be invented or replaced with
placeholders presented as final content.
Examples include:
- approved final assets Jamie still needs to provide;
- the first approved live Happening announcement content;
- any final URLs, copy or product decisions Jamie has explicitly said
  he will confirm;
- external account/DNS/App Store issues that require account-owner or
  provider action.
Before changing a completed revamp page, inspect the current
implementation first. Do not revert it to an older brief/mockup state.
---
# Current website revamp direction
The website is now primarily a public marketing/information site.
Current approved public structure:
- Home
- How it works
- Free & Pro
- Community
- Corporate (`/business`)
- About
- Support
- Privacy
- Terms
Main navigation:
- How it works
- Free & Pro
- Community
- Corporate
- About
- Get the App CTA
There is no News page or `/news` route in the revised brief.
The homepage uses a small admin-managed `Happening` announcement strip
instead.
Corporate `/business` is a website-only landing page.
---
# Legacy web UI
Legacy routes/screens may still exist during the revamp.
Do not delete them merely because they are no longer part of the new
public navigation.
Examples include:
- `/home`
- `/mind`
- `/fitness`
- `/bond`
- `/progress`
- `/pricing`
- `/settings`
Their removal/redirect is a separate controlled cleanup step.
Before removing a route:
1. inspect redirects/navigation;
2. inspect auth flows;
3. inspect API/backend dependencies;
4. inspect mobile dependencies;
5. confirm its replacement;
6. obtain approval.
---
# Website implementation rule
For each website page:
1. review the approved brief;
2. review its supplied HTML/mockup;
3. inspect the current route/component;
4. identify shared dependencies;
5. replace presentation without disturbing backend contracts;
6. preserve responsive behaviour;
7. verify mobile and desktop layouts;
8. stop for review when requested.
Do not redesign beyond the supplied direction unless explicitly
approved.
---
# Website component structure and maintainability
Website revamp code must remain modular and easy to maintain.
Do not place an entire page containing multiple major visual sections
into one large component file.
Prefer:
- one component file per major page section;
- or one component file for a small group of sections that clearly
belong together;
- thin route/page files that primarily compose section components;
- reusable data arrays/constants kept close to the component that owns
them;
- existing shared components/utilities where they genuinely fit.
For the homepage, the intended structure is approximately:
- `HomepageHeader.tsx`
- `HomepageHero.tsx`
- `HomepageHowItWorks.tsx`
  - Three pillars. One score.
  - Every day, three steps.
- `HomepagePlans.tsx`
  - Free & Pro section.
- `HomepageCircles.tsx`
  - Dad Circles.
- `HappeningStrip.tsx`
- `HomepageFounder.tsx`
- `HomepageCrisis.tsx`
- `HomepageFooter.tsx`
Do not create one giant `HomepageSections.tsx` containing most of the
homepage.
Also do not over-fragment small markup into unnecessary one-use
component files.
A component should normally have a clear visual/product responsibility.
When a section contains repeated items such as pillars, steps, plans or
circles:
- keep the data as arrays where appropriate;
- map over the data rather than duplicating markup;
- extract a small reusable child component only when it improves
clarity or is reused.
Styling rules:
- use the existing Tailwind/theme system;
- do not add inline styles for normal page layout/styling;
- do not hard-code brand colours when an existing theme token exists;
- do not duplicate the design system;
- do not add global CSS for page-specific layout unless genuinely
required;
- do not copy standalone mockup HTML/CSS directly into React.
Refactoring presentation into cleaner components is allowed within the
currently approved page scope.
Refactoring must not change:
- product behaviour;
- backend contracts;
- legacy routes;
- shared infrastructure;
- approved copy;
- approved responsive design.
Prefer readable, scoped components over both monolithic files and
excessive fragmentation.
# Homepage revamp
For the new homepage:
- treat the supplied homepage HTML/mockup as the visual/layout target;
- replace old homepage presentation rather than patching it
section-by-section when a clean rebuild is safer;
- preserve global backend providers unless removal has been
independently reviewed;
- do not delete old dashboard routes during homepage implementation;
- use the exact live Dad Health lime rather than mockup placeholder
colours;
- use official App Store and Google Play badges;
- Free & Pro copy must match the final approved mobile entitlement
split.
---
# Happening announcements
The revised website uses a small homepage `Happening` strip.
Requirements:
- up to three live announcement cards;
- date;
- title;
- one-line summary;
- optional button;
- optional `show until` date;
- expired items hide automatically;
- strip disappears entirely when there are no live items;
- Jamie must be able to add/edit/remove items from Admin on mobile;
- use the existing Admin/backend architecture where practical;
- do not introduce a separate CMS unless necessary.
Pending: Jamie must provide the first approved live item: date, title,
summary, and optional button/link.
---
# Business page
`/business` is website-only.
Requirements:
- keep supplied copy unchanged;
- pricing remains `Price on application`;
- do not add numerical prices;
- use the existing site brand/lime;
- keep logo/navigation visually consistent;
- Corporate appears in main nav;
- Corporate also appears in footer;
- enquiry destination is `hello@dadhealth.co.uk` unless later
changed;
- no mobile-app feature should be created for this page.
---
# Completed mobile work
Do not reopen completed mobile milestone decisions while implementing
the website.
Website copy should reflect the completed/current mobile product rather
than old web behaviour.
Do not modify mobile files unless the task explicitly includes mobile.
---
# Database and migration safety
Never:
- edit an already-applied migration to change production behaviour;
- delete historical migrations;
- replace `schema.sql` as a shortcut for a migration;
- apply migrations remotely unless explicitly instructed;
- change canonical score behaviour as part of website presentation
work.
New backend behaviour requires a new migration when appropriate.
---
# Website SEO / search visibility
SEO is an approved website launch/maintenance concern, but SEO work must
remain scoped to the public website and must not disturb shared
mobile/backend infrastructure.
The website uses Next.js. Use native Next.js metadata, rendering and
routing capabilities. Do not add React Helmet or another SEO library
unless there is a demonstrated requirement that Next.js cannot meet.
Before making SEO changes, audit the current implementation and reuse
anything already correct.
Technical SEO requirements:
- public marketing pages must expose meaningful crawlable HTML through
  server rendering or static rendering where appropriate;
- each indexable public route must have a unique, accurate title and
  meta description;
- use canonical URLs for public pages;
- provide appropriate Open Graph and social-sharing metadata;
- maintain a valid robots.txt;
- maintain a valid sitemap containing intended public/indexable routes
  only;
- do not include private, admin, authenticated, API, legacy dashboard
  or intentionally hidden routes in the sitemap;
- do not accidentally add noindex to public marketing pages;
- protect private/admin/authenticated routes from search indexing
  where appropriate;
- use permanent redirects for approved replaced public URLs when
  required;
- use semantic HTML: one clear page-level h1, then logical h2/h3
  hierarchy;
- use descriptive alt text for meaningful images; decorative images
  should not be keyword-stuffed;
- use Next.js image optimisation where appropriate and avoid
  unnecessarily large image assets;
- preserve accessibility while improving SEO;
- keep page performance and Core Web Vitals in mind; do not trade
  major performance regressions for decorative effects;
- add structured data only where it accurately represents visible page
  content and is supported by the page;
- do not invent reviews, ratings, medical claims, organisation facts,
  FAQs or other structured-data content;
- do not keyword-stuff titles, headings, descriptions, alt text or
  body copy;
- do not rewrite approved Dad Health marketing copy solely for SEO
  without approval.
SEO content must reflect the real Dad Health product and current
approved Free/Pro split.
Search-engine launch checks:
- production domain and canonical host must be correct before final
  Search Console submission;
- verify both www.dadhealth.co.uk and the approved root-domain
  redirect behave correctly;
- once production DNS is stable, connect/verify Google Search Console;
- submit the production sitemap through Search Console;
- inspect indexing/crawl errors after launch;
- run PageSpeed Insights/Core Web Vitals checks against the deployed
  production pages and fix material issues with the smallest safe
  changes.
App Store optimisation is a separate mobile/store-listing task. Do not
treat website SEO files or metadata as App Store metadata.
---
# Git safety
Unless explicitly approved:
- do not commit;
- do not push;
- do not apply remote migrations;
- do not deploy production;
- do not make unrelated cleanup changes.
Keep changes scoped to the approved task.
Before reporting completion:
- run relevant tests;
- run typecheck where available;
- run `git diff --check`;
- report changed files;
- report any migrations;
- report unresolved dependencies separately.
---
# Working principle
Prefer the smallest safe change.
Preserve working infrastructure.
Do not convert a UI revamp into a backend rewrite.
When uncertain whether something is presentation or shared
infrastructure, stop and inspect both repositories before changing it.