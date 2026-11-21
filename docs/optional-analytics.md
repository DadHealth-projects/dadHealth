# Optional analytics foundation and funnel instrumentation

Local implementation only. Funnel instrumentation, native consent controls and local PostHog dashboard artifacts are included; production activation is not included. See [onboarding/dashboard handoff](analytics-onboarding-dashboard.md) for the C/D file map and acceptance checks. Native collection is default-off. The approved local retention is seven days for unsent events and thirty days for delivery receipts. Remote retention is unresolved: keep remote delivery disabled.

## Contract and identity

`src/lib/analytics/contract.ts` and mobile `lib/analyticsContract.ts` are identical, checked by a test. Only enumerated event names and per-event properties are accepted. No arbitrary strings, identity overrides, emails, journal text, URLs or provider metadata are accepted. Client ingestion cannot assert persisted-action or billing facts. Existing `trackEvent` callers remain in place, but unsupported events/properties are rejected; legacy navigation events remain distinct from actual paywall presentation. Authoritative facts use the private database helpers described below.

Native `setAnalyticsConsent(owner, 'granted' | 'denied')` is the programmatic consent boundary. Do not call it automatically on login, startup, payment or onboarding. Unknown and denied consent collect nothing. Existing website cookie choices remain the web consent UI. An explicit consent action obtains a server-issued capability, persisted on that device. Its technical lifetime is 30 days. Renewal requires the same unexpired, non-revoked capability while the explicit choice remains granted; a saved preference alone cannot renew or issue one. Failed renewal disables capture without changing the choice. Expiry requires another explicit grant. Old credentials are not recreated by ingestion, even after their receipts are removed. Anonymous identity is never merged into an account. Authenticated ownership is independently checked with Supabase `getUser`; a queued event retains its original owner, UUID and timestamp across logout/restart. Another account cannot deliver it. Withdrawal aborts client requests, clears unsent events and durably queues a revocation-only capability. That capability can revoke but cannot read data or authorize new events. Already transmitted requests cannot be recalled.

Native delivery uses one serialized persistent queue, at most 200 events, eight attempts per event, eight-second HTTP deadlines and exponential backoff capped at an hour. Foreground, connectivity and capture opportunities drain at most ten items; there are no background JS retry timers. Expired events are removed on the next queue access. Consent capabilities awaiting revocation are retained until acknowledged; new consent allocation stops at 200 scope/retirement records. No UI waits for capture or delivery. Web capture is best-effort until backend acceptance; accepted events use the same durable outbox. The web client has no SDK autocapture, session recording, URL/referrer or person-property collection. Existing consent-controlled GTM remains; its remotely managed tags must be reviewed separately before rollout, especially recording/form capture.

## Server and privacy

`POST /api/analytics/events` accepts one <=8KB JSON envelope. Capture requires rollout enablement; owner-bound capture requires verified authentication. Anonymous requests cannot assert billing or first-action facts. Capture is limited to 120 requests per minute by a salted trusted server-side IP hash. Capture fails closed without trusted-IP configuration. Revocation uses a separate 300/minute bucket and remains possible without a trusted IP. Rate buckets expire after one day. No IP enters event payloads. Configure host-level abuse protection as well; application rate limiting is not a substitute for volumetric protection.

Service-only RPCs own consent/outbox mutations. Clients have no direct table or function access. The worker claims one fenced 60-second lease at a time, rechecks consent/deletion before an eight-second provider request, and processes at most 25 per invocation within a 45-second overall budget. Overlapping workers cannot acquire the same current lease. Provider outages retain bounded retries; permanent failures produce safe operational reason codes, never private payloads. PostHog receives a stable UUID/name/distinct ID/original timestamp tuple; retries may reach it more than once. Its documented deduplication is eventual, not unconditional exactly-once delivery.

The migration wraps the installed atomic export dataset with an owner-filtered `optionalAnalytics` section. Existing JSON/PDF processing handles this section; stored export captures are not rewritten. It includes locally retained event fields and delivery state, not capability secrets or rate identifiers. Remote retention MUST be resolved consistently with export coverage: events older than the local 30-day receipt window are not remotely queried into exports. Do not approve longer remote retention without implementing equivalent export coverage.

Deletion acceptance revokes consents and prevents new ingestion/claims under the existing owner advisory-lock order. The privacy worker drains active leases, purges local analytics, then checks durable exposure evidence. New accounts with proven no exposure skip provider cleanup; existing accounts are conservatively unknown. Possible/unknown exposure requires PostHog event/person/recording erasure and verifies completion plus a zero-event query before continuing. A remote request's acceptance alone never completes deletion. Noncompletion after the existing eight privacy attempts becomes a truthful failed operation requiring operational recovery, rather than endless silent pending. A provider request already in flight or delayed in provider ingestion can require another erasure pass. Legacy direct PostHog clients/aliases and provider deletion latency must be checked before activation; local tests cannot prove remote erasure. Anonymous events are intentionally not linked to an Auth owner; their lifetime is governed by consent and the separately approved remote retention.

## Configuration and later operator setup

1. Review/apply `20261120120000_optional_analytics_foundation.sql` after the existing account privacy/export migrations. The predecessor `account_export_dataset(uuid)` must exist. This file is forward-only; no applied migration is modified.
2. Deploy code with capture/delivery/client switches absent or false. No provider call is made by the paused analytics worker; it still performs local retention cleanup.
3. Configure server-only `ANALYTICS_WORKER_SECRET` and independent `ANALYTICS_RATE_SECRET`. Set `ANALYTICS_TRUST_VERCEL_IP=true` only where the platform overwrites `x-vercel-forwarded-for`. Never expose these values in client env or Git.
4. Remote setup needs the correct region: `ANALYTICS_POSTHOG_CAPTURE_HOST` (`https://us.i.posthog.com` or `https://eu.i.posthog.com`), `ANALYTICS_POSTHOG_TOKEN`, `ANALYTICS_POSTHOG_API_HOST` (`https://us.posthog.com` or `https://eu.posthog.com`), `POSTHOG_PROJECT_ID`, and server API key `POSTHOG_API_KEY` with person read/write and query read permission. Verify project IP-discard settings, disabled replay/autocapture, supported deletion API and remote retention. No provider settings have been changed by this implementation.
5. Set `ANALYTICS_PRIVACY_ENABLED=true` before enabling ingestion/delivery, after verifying cleanup credentials and the existing privacy worker schedule. The deletion worker independently requires cleanup according to durable exposure evidence even when all analytics rollout flags are off. Disabling collection never bypasses erasure. With it off, capture and delivery remain blocked.
6. Supabase must have pg_cron, pg_net and Vault. Add Vault entries `analytics_worker_url` = `https://www.dadhealth.co.uk/api/analytics/process` and `analytics_worker_secret` matching the server secret, using the dashboard without printing values. Review `supabase/analytics-worker-scheduler.sql`; it installs an **inactive** authenticated POST job. After operator approval activate `optional-analytics-worker` using `cron.alter_job`. Do not use a GET cron. Keep this retention scheduler running when remote delivery is paused. Monitor cron/net transport results separately from worker receipt state.
7. `ANALYTICS_INGEST_ENABLED=true` enables validated local ingestion. `ANALYTICS_DELIVERY_ENABLED=true` AND `ANALYTICS_REMOTE_RETENTION_APPROVED=true` AND privacy enablement are all required for remote transmission. Leave the retention switch false pending the explicit decision and provider verification. Client switches are `NEXT_PUBLIC_ANALYTICS_ENABLED` (web) and `EXPO_PUBLIC_ANALYTICS_ENABLED` (native). Native consent controls are available in Welcome and Privacy & security; an enable switch is NOT consent.

## Verification and limits

Run backend `node --test tests/analyticsFoundation.test.mjs tests/accountDeletion.test.mjs tests/accountPrivacy.test.mjs tests/accountExport.test.mjs`. Mobile: `node --test tests/analyticsFoundation.test.mjs tests/accountPrivacy.test.mjs tests/startupAuthReliability.test.mjs`. Run each repository's TypeScript checks and `git diff --check`.

Set `ANALYTICS_TEST_CONTAINER` to a disposable `dadhealth-analytics-local-*` PostgreSQL container and run `node --test tests/analyticsDatabase.test.mjs`. It creates a fresh database, applies the real new migration, tests grants/retention/export/withdrawal/deletion, and uses independent psql sessions to observe actual lock contention and rollback. Its minimal auth/privacy predecessor fixtures are **not** full Supabase schema verification. Scheduler installation requires a later Supabase test environment with Vault/pg_net/pg_cron; it has not been executed in plain PostgreSQL.

Device/provider acceptance remains: offline/restart, grant/deny/withdraw, A→B→A, unchanged navigation responsiveness, local cleanup after deletion, controlled provider retry/deduplication and completed remote erasure. Use disposable consenting fixtures only. No real emails, accounts or provider events were used in local tests.

Official references checked 2026-11-20: [Capture v1](https://posthog.com/docs/api/capture-v1), [event deduplication](https://posthog.com/docs/data/events), [person deletion/status](https://posthog.com/docs/api/persons), [data storage/privacy](https://posthog.com/docs/privacy/data-storage). Provider acceptance and local fixture results are not device or live-provider verification.

## Changed-file map

Paths below are relative to their repository. The foundation map is followed by the additional funnel file map; no packages or UI designs changed.

| Repository | Files | Purpose |
|---|---|---|
| Backend | `src/lib/analytics/contract.ts` (new), `src/lib/analytics/service.ts` (new) | Validated contract, ingestion limits, worker and stable provider delivery |
| Backend | `src/app/api/analytics/events/route.ts`, `src/app/api/analytics/process/route.ts` (new) | Verified ingestion and authenticated POST worker |
| Backend | `src/lib/analytics/privacy.ts` (new), `src/lib/privacy/deletion.ts` | Async remote erasure and truthful existing deletion integration |
| Backend | `src/lib/analytics.ts`, `src/components/analytics/AnalyticsConsent.tsx` | Existing web consent, manual allowlisted transport, revocation recovery; no SDK automatic capture |
| Backend | `supabase/migrations/20261120120000_optional_analytics_foundation.sql` (new) | Consent/outbox/rate tables, private RPCs, deletion trigger and atomic export wrapper |
| Backend | `supabase/analytics-worker-scheduler.sql` (new) | Inactive Vault-backed POST schedule for later operator setup |
| Backend | `tests/analyticsFoundation.test.mjs`, `tests/analyticsDatabase.test.mjs`, `supabase/tests/analytics_foundation.sql` (new) | Service/routes/web/provider fixtures and real isolated SQL/concurrency |
| Backend | `tests/accountDeletion.test.mjs` | Declare analytics dependency in existing disabled-analytics regression harness |
| Backend | `docs/optional-analytics.md` (new) | Contract, rollout, privacy limitations, setup and results |
| Mobile | `lib/analyticsContract.ts`, `lib/analyticsQueue.ts` (new), `lib/analytics.ts` | Typed allowlist and persistent owner/consent-safe bounded delivery |
| Mobile | `contexts/AuthContext.tsx` | Owner-bound transport and app-session lifecycle after auth resolution |
| Mobile | `lib/accountPrivacyCleanup.ts` | Retire and clear only the deleting owner's analytics queue |
| Mobile | `tests/analyticsFoundation.test.mjs` (new) | Queue, identity, consent, restart, stale work and contract parity |
| Mobile | `tests/accountPrivacy.test.mjs`, `tests/startupAuthReliability.test.mjs` | Existing harness dependency updates; original behavioural assertions preserved |

## Prior foundation verification (historical record)

- Backend analytics/deletion/privacy command above (excluding export): **63 passed, 0 failed**. Includes 15 analytics tests, actual route handlers with controlled dependencies, web consent, deletion drain and provider-status fixtures.
- Mobile command above: **54 passed, 0 failed**. Includes 11 analytics queue/contract tests.
- `tests/accountExport.test.mjs`: **22 checks passed** during the combined regression run, including actual PDF generation and bounded large capture (2,802 pages; approximately 81.4MB peak heap for the fixture). That initial combined run also exposed missing analytics imports in the separate deletion harness; those were fixed and all deletion/privacy checks rerun successfully. The export implementation was unchanged.
- Isolated PostgreSQL: **26 SQL assertions passed**; **2 Node database tests passed**. Independent sessions observed `pg_stat_activity.wait_event='advisory'`, one durable row for simultaneous duplicates, deletion blocking, rollback without a row and successful retry.
- Mobile TypeScript passed. Backend TypeScript reports **18 baseline errors**; an in-memory HEAD-source compiler run reproduced the same 18 without changing working files. Affected existing files: `src/app/api/admin/[resource]/route.ts` (9), biometric exchange (1), business enquiry (1), Stripe sync-checkout (2), Stripe webhook (2), waitlist (1), `AuthModal.tsx` (1), `LegalDocument.tsx` (1). No analytics diagnostics remain.
- Git diff whitespace checks passed. Unrelated mobile `eas.json`, staged local-record removals and the existing patch deletion were preserved.

These are local fixture results. No production migration, scheduler installation, PostHog capture/erasure, real-account operation or device test has been performed. Remote retention, legacy-client draining/alias inventory, GTM configuration review and full Supabase/provider acceptance remain rollout prerequisites.

## Funnel implementation and exact additional file map

| Batch | Files | Implementation and focused checks |
|---|---|---|
| A corrections | `src/lib/analytics/service.ts`, `src/app/api/analytics/events/route.ts`, `supabase/migrations/20261120120000_optional_analytics_foundation.sql`, `tests/analyticsDatabase.test.mjs`, `supabase/tests/analytics_foundation.sql` | Separate fail-closed capture/revocation limits; ownerless pre-upload revocation; claimed-row contract validation; realistic privacy tombstone fixture. Scheduler already creates an inactive job only on first installation; preserved. |
| Contract | `src/lib/analytics/contract.ts`; mobile `lib/analyticsContract.ts` | Separate client/server allowlists; numeric milestone enums; unknown upgrade source. Byte parity test remains. |
| B1 | mobile `lib/analyticsSessions.ts`, `hooks/useAnalyticsPresentation.ts`, `lib/analytics.ts`, `contexts/AuthContext.tsx`, `screens/subscreens/WelcomeScreen.tsx`, `screens/subscreens/ProSubscriptionScreen.tsx` | One cold session, 30-minute background threshold, layout + focus presentation gate, no rerender/navigation events; private persisted-profile completion. `analyticsFunnel.test.mjs` presentation/session tests. |
| B2 attribution | mobile `lib/analyticsOccurrence.ts`, `lib/analyticsQueue.ts`, `lib/supabase.ts`, `lib/offlineStorage.ts`, `lib/offlineSync.ts`, `hooks/useDashboard.ts`; backend `src/lib/analytics.ts`, `src/utils/supabaseClient.ts` | Synchronous explicit consent snapshot attached to authenticated persistence, no analytics await on user saves. Offline check-ins retain original scope; legacy/no-consent replay explicitly sends none. A later edit cannot attach later consent to a queued pre-consent check-in. |
| B2/B4 database | `supabase/migrations/20261120130000_analytics_funnel_facts.sql` | Atomic first-action enqueue and suppression, canonical streak output trigger, fixed-zone return cohort, private helpers/grants, export and deletion integration. |
| B3 | `src/lib/analytics/billing.ts`, `src/lib/native-subscriptions/store.ts`, `src/lib/native-subscriptions/types.ts`, `src/lib/native-subscriptions/apple.ts` | Verified-input adapter, stable provider/environment keys, paid-transition requirement, replay/order suppression, renewal-off cancellation, unavailable reason. Apple signed positive payment evidence is passed separately from entitlement status. Current entry passes **no applicable billing consent**, so no billing events or extra analytics RPC occur. |
| Tests | backend `tests/analyticsFunnel.test.mjs`, `tests/analyticsFunnelDatabase.test.mjs`, `tests/nativeSubscriptions.test.mjs`; mobile `tests/analyticsFunnel.test.mjs`, `tests/startupAuthReliability.test.mjs` | New behavioral/SQL tests and dependency wiring in existing harnesses; existing assertions preserved. |

### Event meanings and occurrence consent

- `app_opened`: first auth-resolved launch in this JS process, or active after at least 30 minutes in background. Account resolution/change is not a new launch; inactive interruptions alone do not qualify.
- `onboarding_started`: focused, laid-out Welcome for an incomplete authenticated owner. Server suppression survives relaunch. Existing completed profiles are not backfilled. A queued start preceding a newly captured completion is allowed.
- `onboarding_completed`: profile write confirms a nonempty goals array and custody pattern (the existing completion contract). No event is emitted from attempted navigation or a failed write.
- `paywall_viewed`: focused, laid-out subscription screen once per presentation, with an allowlisted source or `unknown`. Existing `paywall_opened` means navigation intent and remains separate.
- `first_checkin`: successful new `mood_logs` persistence. Edits are not new first actions.
- `first_workout_logged`: `workout_sessions`, `workout_completions`, or manual Body `activity_logs`. Multiple representations share one lifetime key.
- `first_bond_log`: `bond_logs`, manual Bond `activity_logs`, or qualified completed Present Dad session. Journal text and unrelated Mind activities never enter this event.
- `streak_reached`: 7/14 from `streak_reconciliation_state` becoming current, reading the canonical saved `user_streaks` result. Scheduled/pending reconciliation emits nothing. No scoring/reconciliation function was rewritten.
- `return_day_reached`: actual received `app_opened` occurrence on cohort calendar day 2/7/30, with completion day zero. The canonical timezone is fixed at consented completion. Later timezone changes do not move the cohort. Missed days are not manufactured.

The request capability is checked against `auth.uid()` and its original scope; a background job does not select another device's or the account's latest consent. No consent is inferred from login, terms, Pro status or subscription verification. No new optional events are collected by default.

Suppression keys are minimal operational anti-backfill records: owner + event key only, without event time, payload, content or values. They are created for existing history and first persisted facts even when collection is suppressed, so later consent and receipt expiry cannot fabricate a first event. They are never sent to PostHog, are owner-exported, and disappear on deletion. They are distinct from consented event collection. A source-history check suppresses false first events if the receipt itself could not be recorded; it never substitutes a later action. Successfully written recovery receipts retain the original occurrence and consent when subsequent enqueueing fails.

The return cohort is optional: created only at consented completion, removed on consent withdrawal/deletion, and expired after 38 days (day-30 window plus the existing seven-day queued-delivery window and calendar boundary allowance). Active cohort consent is retained for that short window. Queue retention remains seven days; receipts remain thirty days. Lifetime suppression keys persist until deletion to prevent duplicate lifetime milestones.

Optional trigger failures roll back only their analytics work and emit a SQLSTATE-only operational log. A 100ms analytics lock deadline prevents optional collection holding up a business save. Recovery receipts retry on the existing worker cadence and expire after seven days into suppression-only keys; this is not unconditional exactly-once analytics. Existing scoring, billing access and privacy barriers still enforce business correctness.

### Billing activation dependencies

The adapter accepts only internal verified provider snapshots. It compares owner, provider, subscription, environment and verification ordering; conversion additionally requires positive verified payment after a previous verified trial. Active status and manual access are never payment proof. Renewal cancellation is distinct from expiry. Existing cancellation feedback has no reliable provider-event link, so the emitted reason is `unavailable`; no free text is copied.

There is **no approved applicable background-billing consent source**. The existing persistence entry therefore calls the adapter with no consent and no inferred account-wide predecessor/context. Enabling a delivery environment flag does not enable billing collection. Activation requires an approved attribution policy and binding its consent window and prior verified snapshot to the adapter. Apple exposes signed positive payment evidence. Stripe invoice.paid supplies matched positive payment evidence; out-of-band and zero payments are excluded. Google Orders evidence is optional behind ANALYTICS_BILLING_EVIDENCE_ENABLED and failures do not fail purchase verification. Free-trial analytics requires the verified freeTrial phase, not an offer name alone. A verified first paid service period matching the trial end can establish conversion when an active snapshot arrived first. Missing or ambiguous evidence suppresses the fact. Google Play/Item 07 work remains deferred. A 50% offer remains a product dependency and is not implemented.

### Migration / rollout order

1. Review/apply the pending foundation migration `20261120120000_optional_analytics_foundation.sql`, then `20261120130000_analytics_funnel_facts.sql` and the forward `20261120140000_analytics_scope_contention.sql` correction, after their existing privacy/scoring/subscription predecessors. No applied migrations were rewritten. No production SQL was executed here.
2. Deploy compatible backend and mobile source only after review. No consent is granted by deploying this code.
3. Keep native collection default-off and remote delivery disabled. Configure the foundation secrets, trusted IP, authenticated POST retention schedule and privacy cleanup first; the operator script preserves an existing job's activation state.
4. Resolve remote retention and verify PostHog deletion/export compatibility before approving remote delivery. Native consent UI is implemented locally; device verification remains pending. Configure neither an inferred billing-consent default nor a 50% offer.
5. Website `$pageview` is a consented page-load event with no URL/referrer/text properties. It is not full SPA route tracking.

### Earlier local verification / remaining acceptance (superseded by blocker verification below)

Final local checks (2026-11-20):

- Backend: `node --test tests/analyticsFoundation.test.mjs tests/analyticsFunnel.test.mjs tests/accountDeletion.test.mjs tests/accountPrivacy.test.mjs tests/streakReconciliation.test.mjs`: **77 passed, 0 failed, 6 skipped**. The skipped pre-existing streak SQL cases require their separate fixture; they are not claimed as passing.
- Mobile: `node --test tests/analyticsFoundation.test.mjs tests/analyticsFunnel.test.mjs tests/startupAuthReliability.test.mjs tests/accountPrivacy.test.mjs`: **60 passed, 0 failed**.
- Foundation isolated database: `tests/analyticsDatabase.test.mjs`: **2 passed**, including **26 SQL assertions**, independent-session lock observation, duplicate ingestion and rollback/retry.
- Final funnel isolated database: with `ANALYTICS_TEST_CONTAINER=dadhealth-analytics-local-20261120`, `node --test tests/analyticsFunnelDatabase.test.mjs`: **10 passed, 0 failed, 0 skipped**. Actual canonical streak replay functions were exercised. Independent deletion connection observed `wait_event=advisory`; rollback, concurrency, all first-action representations, fixed-zone returns, export, withdrawal and retention passed.
- `npx.cmd tsc --noEmit --pretty false`: **passed in both repositories**. This supersedes the historical backend TypeScript result above.
- `git diff --check`: **passed in both repositories**; unrelated `eas.json` has Git's existing LF/CRLF warning.
- Broader regressions exposed **five pre-existing mobile failures**: four `offlineMode` source expectations (old offline copy, Fitness toast, Community error expression and dashboard cache helper order), and the `subscriptionUiRecovery` extracted harness missing `reportMounted`. Relevant screen files are unchanged from HEAD; the expected dashboard helpers are absent in HEAD too. Two introduced auth-harness dependency failures were fixed and the focused run above passes.
- Broader native subscription regressions: **28 passed, 2 pre-existing failures**. One expects absent historical migration `20260820120000_native_subscriptions.sql`; the other matches an existing `publishTime`/`publishedAt` comment in unchanged Google source. Neither assertion was weakened or unrelated source rewritten.

These are local fixtures, not live-provider/device verification. The source-derived PostgreSQL fixture uses actual table definitions and actual canonical calendar/streak replay functions; it is not a complete Supabase deployment. Vault/pg_net/pg_cron integration still needs the supported Supabase environment.

Device acceptance: explicitly consent a disposable fixture using the new Welcome/Settings controls; cold launch, under/over-30-minute background, denied/withdrawn consent, incomplete/completed onboarding, rerender/back/reopen paywall, offline check-in and restart, A-to-B switching, and deletion cleanup. Confirm no navigation/save latency regression and no private properties. Provider acceptance must separately confirm controlled verified trial/payment/cancellation events and remote delivery/erasure once their consent/retention gates are approved. Do not test on real users or claim collection while gates are disabled.


## Blocker corrections ? 2026-11-20

### Exact correction map

| Requirement | Implementation | Focused verification |
|---|---|---|
| Original first-action recovery | `supabase/migrations/20261120140000_analytics_scope_contention.sql`: `analytics_action_recovery`, `analytics_persisted_action`, `recover_analytics_actions` | `tests/analyticsFunnelDatabase.test.mjs`: consent-lock contention; transient enqueue failure; concurrent saves/rollback; source history; export/retention |
| Expiring credentials, no resurrection | foundation `issue_analytics_consent`, `renew_analytics_consent`, `ingest_optional_analytics`; final `analytics_write_scope`; `src/lib/analytics/service.ts`, events route; web `src/lib/analytics.ts`; mobile `lib/analyticsQueue.ts`, `lib/analytics.ts`, `lib/analyticsOccurrence.ts` | database capability renewal/withdrawal/deletion races and cleanup replay; mobile failed renewal/restart/retirement race tests; web explicit grant/login/withdrawal tests |
| Exposure before handoff | final migration `analytics_exposure`, `authorize_optional_analytics`, `prepare_analytics_erasure`, `confirm_analytics_erasure`; `src/lib/privacy/deletion.ts` | database exposure/lease/unknown/never cases; `tests/analyticsFoundation.test.mjs` provider uncertainty, missing credentials and deletion exhaustion; existing `tests/accountDeletion.test.mjs` |
| Verified billing | final `upsert_subscription_analytics_snapshot`; `src/lib/native-subscriptions/{store,types,apple,google}.ts`; `src/lib/analytics/{billing,provider-evidence}.ts`; `src/lib/stripe/sync-user-profile.ts`, Stripe webhook | `tests/analyticsFunnel.test.mjs` payment proof/order/environment; actual PostgreSQL before/current canonical snapshot test; `tests/nativeSubscriptions.test.mjs` canonical payload/evidence regressions |
| Production-equivalent trial dependency | `tests/fixtures/subscription-trial-periods.sql` only: supplied columns, composite FK, check, grants, RLS, guard trigger | Installed in isolated funnel database using source privacy functions; no production trial-table migration |
| Export/deletion/retention | final private export wrapper adds `analyticsRecovery`, `analyticsExposure`; recovery deleted at acceptance; exposure survives until confirmed cleanup; existing funnel/cohort wrappers retained | owner-filtered export, private helper grants, first-action suppression after expiry, deletion lease drain |

The new recovery receipt is committed with its source business save before optional enqueueing. A failed enqueue rolls back only its subtransaction. Worker recovery does not depend on the delivery-enabled flag. The seven-day limit still applies to original occurrence time. On failure of receipt creation itself (for example database corruption or privileges), optional telemetry remains suppressed and cannot be reconstructed; source-history suppression prevents replacing it with a later first action.

Exposure is a minimal deletion-safety record, not an event receipt. Its owner, state and first possible handoff time remain until deletion reconciliation completes. It has no Auth foreign-key cascade because Auth removal must not erase cleanup obligations. Existing Auth owners are marked unknown; newly created owners start never-exposed. Exposure is committed by the authorization RPC before any HTTP attempt, including one whose response is lost. It is exported without secrets. Collection/delivery flags never waive cleanup. Exhausted privacy attempts remain failed/pending attention rather than successful.

### Installation versus activation

Apply the three **unapplied** migrations in this exact order after the installed privacy, scoring and subscription predecessors:

1. `20261120120000_optional_analytics_foundation.sql`
2. `20261120130000_analytics_funnel_facts.sql`
3. `20261120140000_analytics_scope_contention.sql`

Install all three before deploying the matching backend: subscription persistence and privacy processing call the final new wrappers. Do not deploy an intermediate migration/code combination. The existing private export function and predecessor wrappers stay private; no service-role direct export grant is added. No change to the existing privacy-worker schedule is required.

Installation itself makes no provider requests and can be reviewed independently of remote activation. The local fixture exercises real PostgreSQL functions and supplied trial-table structure, but is not a full live-schema diff or Supabase/Vault installation. Run `supabase/analytics-read-only-verification.sql` after installation. Verify grants/search paths, all seven analytics tables, trial-table constraints, triggers and migration versions. Do not display capabilities or event contents.

Before deploying the new privacy worker, configure existing PostHog deletion/query credentials for unknown legacy exposure. Otherwise deletion of an existing account correctly stops at unresolved analytics cleanup; flags cannot bypass it. Do not switch off or replace the existing privacy scheduler. Keep remote delivery and retention approval false until an explicit remote retention period and provider deletion/export coverage are verified. Configure the separate inactive analytics POST scheduler only after operator review; local retention/recovery should then run even while remote delivery is paused.

Google payment enrichment is default-off (`ANALYTICS_BILLING_EVIDENCE_ENABLED`); later setup requires existing Android Publisher credentials with Orders access. Android parity/Play verification remains deferred. No Google provider request was executed locally. Stripe invoice handling uses the existing verified webhook and existing API credentials; enable the relevant event subscription later if absent. Apple uses existing verified signed transaction evidence. Provider mocks do not establish live acceptance.

Outstanding product decisions: remote PostHog retention duration/configuration and export compatibility; applicable explicit consent for background billing; meaning/implementation of any 50% offer. No billing collection is activated by the completed adapters. No reasons, retention periods or offer behavior are invented.

Official adapter references checked 2026-11-20: [Google Orders](https://developers.google.com/android-publisher/api-ref/rest/v3/orders), [Google subscription phases](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2), [Stripe invoice](https://docs.stripe.com/api/invoices/object?api-version=2024-10-28.acacia). Live provider credentials, permissions and delivery remain unverified.

### Blocker verification executed

- Backend: `node --test tests/analyticsFoundation.test.mjs tests/analyticsFunnel.test.mjs tests/accountDeletion.test.mjs tests/accountPrivacy.test.mjs` — **74 passed, 0 failed**.
- Mobile: `node --test tests/analyticsFoundation.test.mjs tests/analyticsFunnel.test.mjs tests/onboardingConsent.test.mjs tests/accountPrivacy.test.mjs tests/startupAuthReliability.test.mjs` — **72 passed, 0 failed**. After the final queue-expiry correction, `node --test tests/analyticsFoundation.test.mjs` — **14 passed, 0 failed**, including the new preserved-identity queued-event renewal case.
- PostgreSQL: `ANALYTICS_TEST_CONTAINER=dadhealth-analytics-local-20261120 node --test --test-concurrency=1 tests/analyticsDatabase.test.mjs tests/analyticsFunnelDatabase.test.mjs` — **18 passed, 0 failed**, including 26 foundation SQL assertions. Concurrency tests use independent connections and explicit held-lock release rather than relying on a sleep finishing at a particular time.
- Final exposure-initialization guard: `node --test --test-name-pattern='forward migrations|failed exposure initialization' tests/analyticsFunnelDatabase.test.mjs` with the same isolated-container setting — **2 passed, 0 failed**. Missing evidence remains unknown; optional initialization failure cannot reject account creation.
- Native subscription regressions: **28 passed, 2 existing failures**: absent historical `20260820120000_native_subscriptions.sql`, and an unchanged Google source comment matching the old `publishTime|publishedAt` assertion. Assertions were not weakened.
- Export regression attempt: **18 checks passed**, including real multipage Unicode PDF, JSON preservation, authentication/expiry/deletion restrictions and immutable email retries. The unchanged `PDF generation propagates malformed capture and cancelled input rather than a partial success` test stalled; its local process was stopped after approximately 167 seconds. The full export suite is **not passed**. No export implementation/test files were changed by this correction.
- TypeScript and tracked diff whitespace checks passed in both repositories. Existing mobile CRLF warnings are not changed. New-file whitespace checks are separate from Git's tracked diff.

These are local Node/VM fixtures and real isolated PostgreSQL checks, not live PostHog, provider, device, scheduler or production-schema installation acceptance. Required remaining device checks: grant/deny, offline/restart, A-to-B-to-A account switching, renewal failure and reconnect, withdrawal during an in-flight send, and deletion status with configured remote cleanup. Provider checks require approved disposable identities and remote-retention activation; none were performed here.
