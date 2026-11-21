# Optional analytics: onboarding and dashboard handoff

Local implementation only. Remote delivery remains disabled. No production SQL,
dashboard mutation or device/provider verification was performed.

## Changes

Mobile:
- `lib/onboarding.ts`: existing canonical profile age bands and explicit
  `no_children` custody value; existing completed-account rule retained.
- `hooks/useOnboardingProgress.ts`: owner-bound restoration of saved profile and
  device draft, private registered storage, stale-response guards. Unknown saved
  age strings remain visible and preserved unless the user explicitly removes them.
- `screens/subscreens/OnboardingGoalsScreen.tsx`,
  `screens/subscreens/OnboardingCustodyScreen.tsx`: confirmed saves, synchronous
  duplicate guard, owner guards; family details remains the third screen.
- `components/AnalyticsConsentControl.tsx`, `screens/subscreens/WelcomeScreen.tsx`,
  `screens/subscreens/PrivacySecurityScreen.tsx`: explicit default-off device/account
  choice and existing privacy-policy route. Continue does not grant consent.
- `lib/analytics.ts`, `lib/analyticsQueue.ts`: read stored consent through the existing
  serial queue; regrant correctly republishes the current request scope. No pre-consent
  event replay. A still-present Welcome can emit a new consented occurrence at grant.
- `lib/onboardingHandoff.ts`, `contexts/AuthContext.tsx`,
  `contexts/UpgradeMomentContext.tsx`, `lib/proNavigation.ts`,
  `screens/DashboardScreen.tsx`: defer upgrade prompts through setup and its initial
  check-in; reuse the one existing daily prompt/modal and its native onShow receipt.
  Dismissal does not complete a check-in. Restart uses existing owner-scoped daily
  prompt persistence, not a second onboarding prompt queue.
- `screens/subscreens/DadDaysSearchScreen.tsx`: no default Primary; explicit choices
  survive foreground allowance refresh and take precedence over a late default.
  Account changes invalidate defaults. Existing saved activities/radius are preserved.
- `tests/onboardingConsent.test.mjs`, `tests/startupAuthReliability.test.mjs`:
  new behavioural fixtures and dependency wiring for the existing Auth harness.

Backend:
- `src/lib/familyAges.ts`, `src/app/api/dad_days_searches/route.ts`: owner-derived
  youngest saved age default; unknown/missing ages require selection. The existing
  Dad Days `teen` API band means 12+, so the saved adult band maps to it without
  changing stored ages. No custody-based recommendations or scoring changes.
- `20261120140000_analytics_scope_contention.sql`: forward correction discovered
  during expanded concurrency checks. Consent-lock contention is not absence of
  consent and cannot consume a no-consent first-event key. Existing 100ms optional
  trigger timeout and business-save independence remain intact.
- `scripts/analytics-dashboard.mjs`, `docs/analytics-dashboard.json`:
  reproducible local definition and explicit operator-only provisioning.
- `tests/analyticsDashboard.test.mjs`, `tests/dadDaysAllowance.test.mjs`,
  `tests/analyticsFunnelDatabase.test.mjs`:
  dashboard, age mapping and source-derived profile schema/owner-RLS checks.
- `supabase/analytics-read-only-verification.sql`: consolidated read-only live checks.

## Storage / compatibility

`user_profile.kids_ages` already stores JSON bands: `toddler_0_4`, `primary_5_11`,
`teen_12_plus`, `adult_18_plus`. Custody fields are existing unconstrained text in
the checkout. `no_children` plus an empty age array explicitly represents no children;
no inaccurate custody selection or made-up age is required. Existing completed
profiles are not reopened merely because they lack age data. Verify live constraints
with the supplied read-only block; checkout definitions do not prove deployment.

No new family table or family schema migration is needed. The existing immutable
export catalogue already includes custody and ages. Normal profile deletion covers
them. Local draft `dadhealth.setup.<owner>` uses the existing owner SecureStore registry
and deletion barrier; it is covered by account cleanup. As with other unsynced device
drafts, it is excluded from a server-only export. No child age, custody answer or draft
content is added to analytics. The existing analytics storage/export/retention rules
are unchanged. Website cookie consent remains unchanged.

## Dashboard setup (later operator action, not executed)

Official API references checked 2026-11-20:
[Insights](https://posthog.com/docs/api/insights),
[Dashboards](https://posthog.com/docs/api/dashboards),
[Funnels](https://posthog.com/docs/product-analytics/funnels),
[SQL](https://posthog.com/docs/sql).

1. Use the existing PostHog project and its existing EU/US region. Do not create
   another project or enable paid features. Verify remote retention before delivery.
2. Generate an artifact offline:
   `node scripts/analytics-dashboard.mjs docs/analytics-dashboard.json`.
   Optional environment inputs: `ANALYTICS_TEST_ACCOUNT` (opaque verified Auth UUID),
   `ANALYTICS_BILLING_ENVIRONMENT` (`production`, `sandbox`, `test`, `legacy`). These
   are query filters, not event identity overrides or grants of consent.
3. Only after separate remote setup approval, provide server/operator environment
   variables `POSTHOG_API_HOST`, `POSTHOG_PROJECT_ID`, `POSTHOG_PERSONAL_API_KEY`.
   Key needs dashboard/insight read/write permissions. Never put it in mobile or Git.
   Run `node scripts/analytics-dashboard.mjs --apply` once, not concurrently. It reuses
   an exact dashboard name, updates its existing insights, rejects ambiguous duplicates
   and can resume after partial failure. It changes no retention/delivery settings.
4. Inspect the resulting insights in PostHog before accepting provider compatibility.
   Local HTTP fixtures do not verify the remote project's API/schema/permissions.

The main funnel is ordered onboarding-started → completed → first check-in → actual
paywall-viewed → verified trial-started → verified paid-conversion, within 30 days.
Stage totals are a separate table and are not sequential conversion counts. Workout,
Bond, return days, streaks and cancellations have separate panels. Unique account
counts use opaque account identity; event totals include repeated qualifying views.
Anonymous opens are a separate panel and never merged into the account funnel.
Billing environment filters apply only to billing stages, because nonbilling events
do not carry billing environment. Test-account filtering isolates the authenticated
panels; the explicitly anonymous panel remains separate.

Only consented occurrences are observable. Never label nonconsenting accounts or
pre-consent onboarding as drop-offs. Billing stages currently remain empty because
applicable background consent/prior verified transition context is unresolved.
Purchases without a trial bypass this funnel. There is no 50% offer event or fabricated
offer count. Cancellation reasons remain unavailable unless reliably attributable.

## Deployment order and activation gates

1. Review pending A/B migrations `20261120120000_optional_analytics_foundation.sql`,
   `20261120130000_analytics_funnel_facts.sql`, then apply the forward
   `20261120140000_analytics_scope_contention.sql` after them. Preserve their existing
   privacy/scoring/subscription predecessors. No production migration ran here.
2. Review backend/mobile code and read-only live verification results. The local
   PostgreSQL fixture is source-derived, not a full Supabase/Vault/pg_net installation.
3. Keep `EXPO_PUBLIC_ANALYTICS_ENABLED` off and remote delivery disabled. Saving a
   consent choice does not override a rollout gate. Schedule authenticated worker/
   cleanup using the existing operator artifact only after configuration review.
4. Remote retention period/configuration, PostHog erasure compatibility, applicable
   billing consent and verified transition context remain activation dependencies.
   The 50% offer needs a separate product decision. Item 07 remains deferred.

## Real-iPhone / provider checklist (not executed locally)

- Fresh account: Welcome → Goals → Family details only; decline consent, choose
  no children, finish. One check-in appears, no upgrade prompt; dismiss, navigate
  and reopen without a duplicate. Then repeat with multiple age bands.
- Interrupt each step, relaunch and verify restored choices; inject a failed save,
  ensure no false completion. Switch accounts during reads/saves and verify isolation.
- Confirm Dad Days defaults to the youngest saved band, keeps an explicit override
  during refresh, and requires selection for missing/unknown ages or no children.
- Grant/deny in Welcome and Privacy & security; restart, withdraw offline, reconnect.
  Check no pre-consent replay, no private properties and no effect on feature access.
- Complete/save then inspect initial check-in prompt timing under biometric and
  notification modal contention; native onShow/dismiss must remain the source of truth.
- After separate rollout approval only: verify actual PostHog identity, dashboard
  filters/counts, sandbox/production separation and deletion/retention behavior.
  Test billing with verified evidence and approved consent; do not simulate counts.

## Executed local verification

- Mobile focused run: **87 passed, 0 failed**, using
  `node --test --test-reporter=tap tests/onboardingConsent.test.mjs tests/analyticsFoundation.test.mjs tests/analyticsFunnel.test.mjs tests/startupAuthReliability.test.mjs tests/savedDadDays.test.mjs tests/item02Acceptance.test.mjs tests/accountPrivacy.test.mjs`.
  After adding the final Dad Days callback regression, reran
  `node --test --test-reporter=tap tests/onboardingConsent.test.mjs`:
  **9 passed, 0 failed** (eight overlap the preceding run).
- Backend focused run: **77 passed, 0 failed**, using
  `node --test --test-reporter=tap tests/analyticsDashboard.test.mjs tests/dadDaysAllowance.test.mjs tests/analyticsFoundation.test.mjs tests/analyticsFunnel.test.mjs tests/accountDeletion.test.mjs tests/accountPrivacy.test.mjs`.
- Isolated PostgreSQL funnel suite: **12 passed, 0 failed, 0 skipped**,
  `tests/analyticsFunnelDatabase.test.mjs`, against the disposable local Docker
  fixture. Includes independent connections, advisory-lock observation, deletion
  contention, five first-action races and a deterministic consent-lock timeout.
  An intermittent first-action loss exposed by this run was fixed by the forward
  contention migration; the final run passes. This is source-derived schema/RLS
  coverage, not evidence of live Supabase installation.
- `npx.cmd tsc --noEmit` passed in both repositories. Diff checks passed.
- Additional conversion regressions: **17 passed, 7 failed** across
  `tests/proConversion.test.mjs` and `tests/upgradeMomentSystem.test.mjs`.
  The same seven failures reproduce against HEAD source using an in-memory source
  loader, without changing the working tree. They concern existing conversion
  entry points, card styling/copy and obsolete weekly-report Pro-gate assumptions;
  they are baseline failures, not claimed fixed by this scope.

No device, live PostHog, live billing or production-database verification is implied.
