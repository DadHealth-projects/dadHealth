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
- pre-launch: Join the Waitlist CTA
- after public app launch: app-download CTA, only when launch state is confirmed
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

# Website design assets and visual source rule

Website review is not complete until the supplied visual assets have been
reviewed as well as the written brief and current code.

For every website page review or implementation:

1. Read the latest relevant written brief in `/product`.
2. Review the supplied HTML/build target where present.
3. Review the latest page mockup/screens.
4. Review all relevant graphics, images, screenshots and other visual assets
   supplied for that page in `/product` and `public`.
5. Inspect the current implementation.
6. Compare any app/product visuals against the current mobile product where
   necessary to make sure outdated UI is not presented as current product UI.
7. Only then propose new assets, screenshots or visual replacements.

Do not assume a visual asset is missing simply because it is not currently
rendered by the website.

Do not propose creating or capturing a replacement graphic until the supplied
assets have been checked first.

When Jamie refers to a visual in feedback such as:

- "this image";
- "this screen";
- "put this on the front";
- "more images";
- "change this";
- "this looks good";

use the associated recording, screenshot/mockup and supplied assets to identify
the intended visual where possible before making an implementation decision.

If the exact referenced visual cannot be identified, report that uncertainty
instead of guessing.

For each visual proposed for use, identify:

- exact source file;
- whether it is current, outdated, placeholder or duplicated;
- intended section;
- desktop treatment;
- mobile treatment;
- expected crop/object positioning;
- aspect-ratio risks;
- whether the source is genuinely unsuitable and needs replacement.

Prefer visual sources in this order when appropriate:

1. Jamie-supplied approved/current assets;
2. current real Dad Health app UI/screens;
3. existing approved Dad Health website assets;
4. new assets only when none of the above are suitable and creation has been
   approved.

Do not:

- fabricate app UI;
- use outdated app screens as current product proof;
- add random stock imagery to fill space;
- stretch or distort supplied images;
- create large empty containers simply to preserve an unsuitable image ratio;
- excessively crop important subjects;
- generate replacement imagery without approval.

Try the supplied image first.

Use responsive image treatment and sensible `object-fit` / `object-position`
where appropriate. Check both desktop and mobile.

If an image genuinely cannot fit the approved design cleanly, report:

- the exact source image;
- the section where it fails;
- why normal responsive cropping cannot solve it;
- the recommended replacement aspect ratio/dimensions.

Only then should a replacement asset be requested from Jamie.

When a website review includes layout, hierarchy, page-length or content
reduction decisions, the visual audit is part of that same review.

Do not recommend removing, replacing or condensing a section without checking
whether its supplied graphic or product visual changes that decision.

## Design-reference graphics versus production assets

Supplied website graphics are not automatically production assets.

When a supplied PNG/JPG/mockup contains:

- text;
- icons;
- cards;
- dividers;
- labels;
- score UI;
- diagrams;
- structured visual content that can reasonably be recreated in HTML/CSS/SVG;

first determine whether the asset is intended as:

1. a final production image to render directly; or
2. a visual/design reference that should be recreated natively.

Do not blindly render a flattened screenshot/graphic when doing so causes:

- blurry text;
- poor scaling;
- oversized desktop presentation;
- unreadable mobile content;
- fixed baked-in copy;
- inaccessible text;
- awkward responsive cropping.

When a supplied graphic is clearly a design reference, use it as the source of truth for:

- visual hierarchy;
- layout;
- proportions;
- spacing;
- borders;
- icon placement;
- typography scale;
- alignment;
- colour treatment;
- overall visual character.

Then recreate the design using the existing application stack:

- semantic HTML;
- React components;
- Tailwind/theme tokens;
- SVG/CSS where appropriate;
- existing approved icon assets where they remain sharp and suitable.

Do not redesign the graphic.
Do not invent new content.
Do not change approved copy.
Do not change the intended visual hierarchy.

The goal is to reproduce the supplied design faithfully while making it:

- responsive;
- accessible;
- sharp at all viewport sizes;
- maintainable;
- text-selectable where appropriate;
- compatible with desktop and mobile.

If the supplied individual icon asset is also low-resolution or unsuitable for responsive use, inspect whether its simple geometry can be faithfully recreated as SVG/CSS from the supplied design reference.

Do not recreate branded photography, complex artwork, logos or illustrations unless explicitly approved.

Example:

A supplied Mind / Body / Bond strip containing three cards, icons and baked-in text should normally be treated as a design reference if rendering the full PNG causes poor responsive scaling.

In that case:

- preserve the wide three-column desktop design;
- preserve the supplied icons/design language;
- render the headings and descriptions as real HTML;
- reproduce dividers/borders/spacing with CSS/Tailwind;
- use responsive sizing rather than scaling the flattened image;
- use the same structured content source across desktop and mobile where practical.

Before replacing a rendered graphic with a native recreation, report the intended approach and obtain approval when the task is review-only.
---
# Website implementation rule
For each website page:
For each website page:

1. review the latest approved brief and later Jamie feedback;
2. review its supplied HTML/build target;
3. review its latest mockup/screens;
4. audit all relevant supplied graphics/images/assets;
5. inspect the current route/components;
6. compare product/app visuals against the current mobile product where needed;
7. identify shared dependencies;
8. propose the smallest safe implementation plan;
9. stop for approval when requested;
10. only after approval, change presentation without disturbing backend contracts;
11. preserve responsive behaviour;
12. verify mobile and desktop layouts after implementation.
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

When a supplied visual contains repeated structured content such as cards,
pillars, steps, score items or comparison items, prefer recreating it from
structured data and reusable markup rather than baking the entire visual into
one raster image.

Use the supplied graphic as the visual source of truth, not as an excuse to
hard-code duplicated markup or fixed screenshot dimensions.
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

Latest Jamie feedback takes precedence over the original homepage mockup where
it changes hierarchy or launch messaging.

Current feedback direction includes:

- reduce homepage length/repetition by approximately 20–30%;
- move detailed content to its dedicated public pages;
- make the Dad Health Score/product UI visible almost immediately;
- use Join the Waitlist rather than Get the App/Coming Soon before launch;
- bring a short authentic founder story onto the homepage;
- use more appropriate real/app imagery;
- keep consumer and Business journeys clearly separated;
- improve mobile body-copy readability;
- make Pro marketing outcome-led while remaining truthful to implemented
  entitlements;
- communicate the anti-scroll philosophy: Dad Health helps dads check in,
  understand where they are, do one useful thing, then get back to real life.

These directions do not grant permission to invent Jamie's pending final copy.
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

---
# Website UI Implementation Rules
The current homepage and this consistency pass are the implemented visual
baseline for public website work. Inspect this file and the existing homepage
before changing public website UI.

- Use `HomepagePrimaryButton` as the shared primary CTA. Preserve its compact
  mobile sizing and slightly larger desktop sizing. Use
  `marketingArrowClass` for equivalent CTA arrows.
- Use the classes exported by
  `src/components/marketing/marketingStyles.ts` for equivalent marketing UI.
- Standard containers use `max-w-7xl px-5 sm:px-6 lg:px-8`.
- Standard section spacing uses
  `py-14 sm:py-16 lg:py-16 min-[1440px]:py-20`. Keep local spacing only when
  the section has a distinct layout need.
- Page heroes use `marketingPageHeroClass`. Standard section headings use
  `marketingSectionHeadingClass`. Preserve distinct display treatments only
  when the content role differs.
- Standard body copy uses `text-[15px] sm:text-base` with relaxed leading and
  muted colour where appropriate.
- Normal cards use `rounded-2xl`, the standard border and card background, a
  restrained primary-colour glow, and compact `p-5 sm:p-7` padding where the
  card role is equivalent.
- Build mobile-first. Keep mobile CTAs compact and readable. Use responsive
  Tailwind breakpoints for tablet, laptop and desktop. Do not let large desktop
  sizing start too early.
- Treat supplied graphics as design references when practical. Recreate simple
  structured graphics as responsive HTML, CSS or React. Do not stretch
  low-resolution raster graphics or replace approved native homepage graphics.
- Never fix website sizing with CSS `zoom`, `transform: scale()`, browser zoom,
  page-wide scaling or root-font-size hacks. Reuse an existing shared value
  instead of adding arbitrary one-off sizing.
- Preserve intentional exceptions: Business conversion layouts and large
  actions, highlighted lime Pro cards, Score visuals, branded phones, legal
  tabs, and narrower legal reading content.
- Check public website UI at 390, 435, 768, 1280, 1366, 1440 and 1920 pixels.
  Verify readable copy, compact mobile layouts, controlled desktop scale and no
  horizontal overflow.
