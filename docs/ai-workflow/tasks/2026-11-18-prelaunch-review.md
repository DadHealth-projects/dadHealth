# Jamie's prelaunch checklist — local implementation and audit

Status: local changes for human diff review; not deployed or device-verified.

Authority: the attached 12-point request authorizes scoped website fixes. Health integration is audit/proposal only. The subsequent placement instruction supersedes item 12's original order: **Hero → in-flow consent notice → founder story → Dad Circles**. Existing founder photo/copy are preserved. No production writes, builds, commits, pushes, package installs or mobile changes.

## Numbered tracker

| # | Status | Work and evidence | Remaining owner/action and approximate effort |
|---|---|---|---|
| 1 Footer | Implemented locally / needs manual input | `HomepageFooter.tsx`: non-medical-service statement; existing company 17407334, 66 Paul Street, London EC2A 4NA, contact email and Terms preserved. | Jamie: confirm registered address against current official Companies House record. Registry verification was unavailable; existing copy is not independent evidence. No invented replacement. |
| 2 Cookies | Implemented locally | `AnalyticsConsent.tsx`, `page.tsx`: user-maintained fixed floating notice, centered above the bottom safe area, with bounded height and internal scrolling. Desktop horizontal; mobile text then equal styled/tappable buttons. Settings focuses reopened choices. One root-layout instance serves every route continuously; the homepage-specific duplicate and route-based unmount gate were removed. The extra Cookie preferences link was removed at the user's request; the existing footer Cookie Settings control reopens the notice. Persistence/withdrawal logic unchanged; scrolling is not consent. | Physical Safari/Chrome keyboard/zoom check, ~30 min. |
| 3 Honeypot | Implemented locally | `HomepageWaitlist.tsx`: native `hidden` plus `aria-hidden`, existing `tabIndex=-1`; server honeypot branch unchanged. API test verifies no email on honeypot submission; browser checks hidden/focus exclusion. | No production submission performed. |
| 4 Signup | Implemented locally | Success now explains that the request was sent to the team; no subscriber-email or launch-date promise. Actual route sends internal Resend email only; no subscriber confirmation or durable waitlist table in this route. Validation/failure/repeat handling unchanged and tested. | Jamie: approve launch window and any future automated contact promise. Duplicate submissions currently send another internal email; not changed into a new deduplication service. |
| 5 Stores | Implemented locally / needs manual input | Hero/footer reuse existing `StoreDownloadButtons prelaunch`: plain non-clickable coming-soon labels, not counterfeit store badges or fabricated URLs. | Jamie supplies live/preorder listings; engineer uses official permitted badge assets and real URLs, ~1–2 h. |
| 6 Free/Pro | Implemented locally / needs manual input | AI time/equipment copy updated across homepage, comparison, plan cards and FAQ. Free weekly score/headline access corrected; Pro detailed reports distinguished. | Jamie confirms published prices against live products, lifetime-Free wording, business privacy guarantees and universal legacy trial CTA eligibility; see claim review below. |
| 7 Screens | Needs manual input | Hero/How It Works/Business phones are JSX illustrations. Available graphics are marketing artwork/website mockups, not approved app captures; preserved. | Jamie: sanitized, approved Today and Community PNGs, ideally 1170×2532 or original uncropped device resolution; suggested `public/app-screens/today.png` and `community.png`. Preserve aspect ratio, render max 320 CSS px. ~1–2 h after delivery. |
| 8 Health | Audit/proposal only | Existing Apple Health and Health Connect readers, RPCs and scoring dependencies inspected. No integration/scoring changes. See below. | Engineering scope approval + native devices; estimate 4–7 engineering days and 2–3 device-QA days, subject to workout/deduplication decisions. |
| 9 Community | Already satisfied in current source/render / asset pending | Active `HomepageCircles`/community content uses Every Kind of Dad and `public/Dad_Health_Web_Graphics/tile-every-kind-of-dad.png`; no active Teen Dad Club reference found. Artwork viewed; not called a real app screenshot. | Jamie supplies genuine approved Community capture if required, as item 7. |
| 10 Privacy | Implemented locally / legal review needed | New `HomepagePrivacy.tsx`: account-owned Journal/check-ins distinguished from community posts, scores and service providers; link to existing Privacy Policy. No absolute secrecy/sale/encryption guarantees added. | Jamie/legal: resolve policy inconsistencies below, ~0.5–1 day engineering after approved legal copy. |
| 11 Responsive | Implemented locally / device-unverified | Local Chromium public-route review at 320/430 px and 200% root text; confirmed overflow fixed in shared containers/headers, How It Works, Business phone and Bond/reset-password wrappers. Primary marketing CTA minimum 44 px. | Physical iPhone/Android keyboard, screen reader, landscape and OS text-size checks remain, ~0.5–1 day. Automated boundary scans do not prove all vertical content or accessibility. |
| 12 Placement | Implemented locally | Latest instruction applied: existing founder story then Dad Circles; hero/content/assets preserved. Test asserts actual adjacent sections. | Human visual review; no invented founder portrait or copy. |

## Files and scope

- Composition: `src/app/page.tsx`; new `src/components/homepage/HomepagePrivacy.tsx`.
- Consent: `src/components/analytics/AnalyticsConsent.tsx`. Root layout retains its original component order and owns the single persistent consent instance. Homepage no longer mounts a duplicate.
- Copy/content: `HomepageFooter.tsx`, `HomepageHero.tsx`, `HomepageWaitlist.tsx`, `HomepagePlans.tsx`; `freepro/FreeProComparison.tsx`, `FreeProPlanCards.tsx`, `FreeProFaq.tsx`.
- Confirmed layout fixes only: `marketing/marketingStyles.ts`, `HomepageHeader.tsx`, `HomepageCircles.tsx`, `HomepageFounder.tsx`, `HomepageHowItWorks.tsx`, `HomepagePrimaryButton.tsx`, `business/BusinessHeader.tsx`, `BusinessBranding.tsx`, `SiteHeader.tsx`, `SitePageShell.tsx`, `src/app/bond/BondPageContent.tsx`, `src/app/auth/reset-password/page.tsx`. No auth or pricing logic changed.
- Tests: `tests/prelaunchWaitlist.test.mjs`, `tests/prelaunchWebsite.browser.mjs`.
- This report. No API, SQL, legal document or mobile source edited.

## Free/Pro claim review

- Score/current trends, daily check-in, breathing/Journal/crisis support, manual logs and Community have Free entry paths in mobile. Free workout access means explicitly Free workouts / independent featured access, not the entire library. Private circle membership remains separate from subscription access.
- `dadhealth-mobile/screens/subscreens/AIWorkoutScreen.tsx` supplies time/equipment; `src/app/api/generate-workout/route.ts` validates duration/equipment and canonical Pro. Meal Planner is also gated server-side.
- `src/app/api/dad_days_searches/route.ts` implements three Free searches per month; Pro has no search allowance cap. This does not promise unlimited service availability.
- `src/app/api/reports/weekly/route.ts` and report service/projector allow Free score/headlines, restrict details. `src/app/api/pro/insights/route.ts` gates detailed/monthly insights. Corrected the confirmed website mismatch that Free had no reports.
- Weekly Pro freeze is implemented in accepted Item 02 code; this website audit does not re-verify production activation or missed-day eligibility.
- Published £6.99/month / £49.99/year are static website copy, not a live Apple catalogue read. Existing legacy `SiteHeader.tsx` says “START FREE — 7 DAYS” without eligibility evidence. Business FAQ promises employers never see individual data. These claims need owner review; no billing configuration, trial logic or legal guarantees changed here.

## Health audit (source evidence, not deployed/device evidence)

### Existing capabilities

- Mobile `lib/appleHealth.ts:151` imports daily steps, exercise minutes, resting HR and sleep using installed HealthKit/Nitro. `lib/healthConnect.ts:174` imports equivalent daily data; aggregation at lines 227/244, paginated record reads around 320. Neither imports individual workout entities or writes workouts back.
- `components/AppleHealthManager.tsx` and `HealthConnectManager.tsx` run on mount/foreground, with throttling and rolling lookback. These are not guaranteed locked/background sync jobs.
- `supabase/schema.sql:2967` / `:3047`: authenticated, auth.uid-derived Apple/Health Connect upsert functions. Manual daily values are preserved; non-manual rows share daily conflict keys. Schema reference is not proof these exact functions are installed.
- Canonical contribution source: `supabase/migrations/20261111120000_mind_participation_and_scoring_calendar.sql` and `20261111130000_body_bond_70_30_scoring.sql`. Steps/exercise minutes/sleep contribute to Body; manual and non-manual components are capped. Caps are not per-event deduplication.

### Gaps and minimum recommended first version

1. Preserve existing read-only steps/sleep/exercise-minute foundation. Harden owner/session checks around native async reads and RPC writes: current sync captures a userId but RPC authenticates the session at write time; changing account during a native read can target the new session. Hooks also lack consistent request-generation guards. This is a source-supported race risk, not a demonstrated device incident.
2. Align device-local date bucketing with canonical account calendars before promising timezone-safe scoring. Do not rewrite historical records or change scoring formulas in this task.
3. Handle revoked/deleted native records and stale imported values explicitly. Current filtered/absent values can leave old database rows; permission-request completion does not prove HealthKit read access.
4. If “workouts” means actual workout sessions, add stable `(provider, externalRecordId)` identity with origin/update/deletion handling, and define manual/imported overlap plus active-minutes/workout double-credit policy before coding. Do not merely sum both or rely on scoring caps. Same event must not create two workout completions. This needs approved reconciliation policy and potentially a forward migration.
5. Leave workout writeback separate (roughly 1–2 extra engineering days plus native round-trip testing). It requires write permissions and origin identifiers to prevent reimport loops; not included in first-version estimate.

### Native and policy requirements

- Installed native libraries exist; Expo Go does not establish native behaviour. `app.json` declares health plugins/permissions, but local `app.config.js` intentionally disables HealthKit in temporary development configuration. Preserve that setup; use a capability-enabled native build/profile for health acceptance.
- Test permission allowed/partial/denied/revoked, empty datasets, foreground refresh, offline recovery, midnight/DST/account timezone, duplicate sources/manual overlap, deletion, and account switch during sync on real iPhone and Android.
- Confirm HealthKit capability/usage descriptions, Health Connect manifest and rationale, Apple privacy disclosures and Google Play Health Apps declarations against actual reads. Do not request background or historical permissions unless the implementation needs them. Store review/credentials are external dependencies, not completed work.
- Official references consulted: [Apple authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data), [HealthKit design/privacy](https://developer.apple.com/design/human-interface-guidelines/healthkit), [Health Connect aggregate/deduplication](https://developer.android.com/health-and-fitness/health-connect/aggregate-data), [Health Connect publishing](https://developer.android.com/health-and-fitness/health-connect/publish).

## Privacy and store evidence

- `supabase/rls-policies.sql:23,81–83` enables Journal RLS and owner-scoped CRUD. This is checkout evidence, not a live policy verification. Scores count participation; the new copy does not promise staff cannot access content.
- `src/lib/analytics.ts:70–73` supports identified PostHog users. `AnalyticsConsent.tsx` initializes optional analytics only after consent, and includes consent-gated GTM. Existing policy's anonymous-analytics wording needs reconciliation with identified events and GTM disclosure.
- `public/terms_files/policy.html` lists Supabase, OneSignal, Resend, PostHog and Anthropic; AI descriptions omit actual workout generation. Existing billing/legal provider language and employer-access guarantees also need owner/legal review. Legal documents were not silently rewritten.
- Official [Apple badge guidelines](https://developer.apple.com/app-store/marketing/guidelines/) and [Google badge assets](https://partnermarketinghub.withgoogle.com/brands/google-play/google-play/lockups-icons-badges/): store badges should use authorized artwork and the corresponding available/preorder listing. A waitlist is not a store listing. Current implementation uses plain coming-soon labels, not download/preorder badges. No store URL invented.

## Verification record

- `node --test tests/prelaunchWaitlist.test.mjs`: **4 passed, 0 failed**. Executes actual route with mocked email/Next adapter; no email sent. Covers honeypot, validation, internal-only recipient/escaping/repeated submissions and failure response.
- `node --test --test-reporter=tap tests/*.test.mjs`: **234 tests, 192 passed, 28 failed, 14 skipped, 0 TODO**. Log `.next/prelaunch-final-tests.log`.
- Clean HEAD archive in ignored `.next/prelaunch-baseline`, same existing suite: **230 tests, 188 passed, 28 failed, 14 skipped**. All 28 failure names match; assertion errors match after normalizing archive paths. Four errors differ only by missing-file root paths (Health Connect, native subscription and notification migrations). Remaining failures include existing source-contract assertions and SQL fixture/execution failures. No SQL pass claimed. Logs `.next/prelaunch-full-tests.log` and `.next/prelaunch-baseline-tests.log` retain individual failures.
- Backend health subset: **2 passed, 3 failed**; failures are also in baseline (two missing Health Connect migration references and stale AI workout source assertion). Mobile health source tests: **11 passed, 0 failed**, command `node --test tests/healthSync.test.mjs tests/healthConnect.test.mjs tests/healthPermissionsCopy.test.mjs`; not device or live database proof.
- Application TypeScript (`tsconfig.app.json`, `--noEmit --incremental false`): **18 existing errors**, exact same diagnostics as clean HEAD. Admin union discrimination, biometric types, replaceAll target, Stripe types and AuthModal timer. Node TypeScript config passes.
- Historical inline-layout browser run (superseded for cookie positioning): **64 checks passed, 46 route/viewport cases, zero layout findings**, local Next dev server only, external writes blocked and waitlist POSTs mocked. 23 routes at 320/430 px, each normal and 200% root text, plus consent/focus/scroll/order/honeypot/validation/recovery checks. Additional legacy-route preference reopening/focus and homepage 320/1440 placement check: **5 assertions passed**. Latest exact results are `.next/prelaunch-browser-final.log` and `.next/prelaunch-review/results.json`; screenshots in `.next/prelaunch-review`. CSS text enlargement is not an OS Dynamic Type or physical-device test. No provider email-delivery claim.
- Public routes reviewed: `/`, `/howitworks`, `/free-and-pro`, `/dad-circles`, `/about`, `/waitlist`, `/business`, `/business/contact`, `/support`, `/privacy`, `/terms`, `/eula`, `/cookies`, `/privacy-request`, `/auth/reset-password`, `/bond`, `/community`, `/fitness`, `/home`, `/mind`, `/pricing`, `/progress`, `/settings`. Account-only content not exercised with real credentials.
- Historical inline-layout consent padding check (not floating-banner evidence): **6 viewport/text-size cases passed** (320/430/1440 px at 100%/200%), no horizontal overflow, buttons within viewport and at least 44 px tall. `git diff --check` passes; new files checked for trailing whitespace. Browser screenshots may use fallback fonts where external font loading is unavailable; font fidelity and OS accessibility remain device review items.
- Local server reported blocked remote Happenings reads (`EACCES`) and a hydration warning during development. Public pages still returned 200; layout checks do not verify live Happenings content or prove a console-clean production render. These are not claimed fixed. The temporary local development server was stopped after checks.

## Preserved pending work / release boundary

### Floating-banner and navigation correction — 2026-11-18

The user's floating-banner implementation supersedes all earlier inline-cookie assertions above. Its fixed positioning, safe-area spacing, sizing and styling were preserved. The subsequent navigation correction removes the homepage-specific instance/route gate; the single root-layout instance now retains consent state across client navigation. The user then requested removal of the redundant Cookie preferences link; only the existing footer Cookie Settings control remains.

Updated `tests/prelaunchWebsite.browser.mjs` checks fixed viewport bounds, internal scrolling, preference focus on other routes and the same DOM notice surviving actual mobile menu navigation back to Home. It retains consent persistence, no consent from scrolling, equal tappable controls and waitlist assertions.

Focused checks actually executed: 9 navigation/consent assertions passed; 6 floating-banner viewport cases (320/430/1440 px at 100%/200% text) passed; 4 waitlist tests passed. Application TypeScript still has the exact same baseline diagnostics; diff check passed. One wide browser attempt stopped on a missing HTTP navigation response at `/settings`; that attempt is not counted as passing. No application changes were made to work around that test failure.

After removing the redundant link, a clean focused browser run passed **13 assertions**: persistent notice through actual navigation, rejected consent across pages, absence of Cookie preferences, footer Cookie Settings reopening/focus, explicit acceptance and dismissal. The concurrent wide rerun failed its same-DOM-node assertion while source edits were still occurring; HMR interference is possible, not proven. That wide run is not claimed passed; the isolated final navigation run passed. No production/device acceptance inferred.

Backend's pre-existing deleted task files (`2026-11-12-m3-01.md`, `TEMPLATE.md`) remain untouched. Mobile's pre-existing `eas.json` modification remains untouched. No native/signing or health source edits. Do not interpret this report as production launch acceptance: business details/assets/legal claims, baseline failures and physical-device checks remain explicitly pending.
