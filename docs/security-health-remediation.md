# Security and existing health integration remediation

Local verification: 26 November 2026. No production SQL, scheduler changes, provider operations, deployment, commits or pushes were performed. Weekly report, scoring, subscription behaviour, analytics and signing configuration were not changed.

## Implemented

- A forward migration removes anonymous/PUBLIC writes, TRUNCATE, REFERENCES and TRIGGER from nine audited tables. Previously effective guest SELECT and authenticated/service CRUD are preserved. RLS remains intact.
- Anonymous `can_save_recipe` execution is removed. The five guest policy helpers remain available: removing their execution would break nested workout, recipe or community policy dependencies.
- `complete_task` and `handle_daily_checkin` reject foreign-owner calls; service-role calls retain their intended operation.
- `get_comment_author_names` requires authentication, accepts at most 200 UUIDs, and returns names only for visible named posts or comments. Anonymous posts alone never authorize identity disclosure. Existing block/private-circle helpers govern visibility.
- Direct `net` schema/function/table/sequence access is removed from PUBLIC, anon and authenticated. Worker schedules, six worker wrappers, owner privileges and extension placement are unchanged.
- The privileged Supabase client now imports `server-only`. API/provider logs use fixed allowlisted codes/statuses instead of raw errors; meal-plan provider bodies/messages are no longer logged. Legacy wearable errors are fixed codes.
- Native health requests use an isolated client with the starting owner's token pinned at the actual fetch boundary. Account/logout/disconnect invalidation aborts pending requests. The shared client's later credentials cannot replace it.
- A connection-ID-bound RPC serializes uploads against disconnect, preserves manual records and updates last-success time in the same transaction. Legacy native RPC signatures remain supported. Legacy wearable writes use the same manual-preserving operation.
- Failed native reads do not become zero records or a successful full-sync timestamp. Successfully read types may still persist. Apple empty reads remain ambiguous and cannot erase history. Health Connect permissions are rechecked before upload.
- Failed profile/timezone reads stop import instead of silently switching historical daily buckets to the phone timezone. Hook results/error/finally updates are owner-guarded.

## Permission changes and limits

Affected tables: `circle_prompts`, `comment_likes`, `comments`, `likes`, `posts`, `recipes`, `saved_posts`, `user_saved_recipes`, `workouts`.

Before: the supplied production evidence showed excessive anonymous privileges, including TRUNCATE on eight tables. After migration: anon retains SELECT only where it already had SELECT; table writes/destructive privileges are revoked from both anon and PUBLIC. Authenticated/service effective CRUD is made explicit before revocation. Existing RLS still determines which SELECT rows are visible.

Guest helper isolation into a private schema was investigated but not implemented. Moving helpers safely requires coordinated policy/function dependency changes and live definition comparison; revoking their execution first would break guest reads. Retained helpers return access booleans, not private records. The author-name RPC has its own content-visibility authorization.

Automatic Data API exposure is unchanged. Do not switch it off until all required effective table, sequence and function privileges are inventoried and made explicit, including schemas outside this nine-table scope. Leaked-password protection remains a Supabase-plan dependency.

The pg_net placement warning remains unresolved. This change does not relocate, uninstall or recreate the extension. Verify ACLs again after extension upgrades. Local worker testing verifies owner-executed permission dependencies using a `net` fixture; it does not invoke HTTP or prove production cron delivery.

## Migration and release order

1. Review and apply `supabase/migrations/20261126120000_security_least_privilege.sql`.
2. Review and apply `supabase/migrations/20261126121000_health_sync_boundaries.sql`.
3. Verify grants, guest reads, authenticated writes, worker owner/ACL dependencies and health RPC signatures with bounded read-only checks.
4. Release backend logging/server-only changes and the wearable function change after the RPC exists.
5. Release the mobile JavaScript changes after the RPC exists. Old mobile RPC names remain supported, but old clients do not gain pinned-token/connection-ID protections until updated.

These are pending migrations, not proof of production remediation. No native package was upgraded. An existing build with HealthKit/Health Connect modules can receive the JavaScript changes; a build excluding HealthKit still needs a correctly configured native rebuild for Apple Health acceptance. Preserve the deliberate temporary-build extension configuration.

Rollback: prefer a corrective forward migration. Before rollout, privately capture existing function definitions and ACLs. If the health RPC needs rollback, roll mobile/wearable callers back first, then restore prior health function definitions through a forward migration; do not delete imported data. Do not restore broad anonymous/net privileges as a routine rollback. Retain the security migration and repair a specific missing legitimate grant only after confirming its dependency. Do not reinstall pg_net or alter schedules.

## Verification and known gaps

- Mobile health suites: 40 passing tests (37 core/transport/native/copy checks plus three Health Connect lifecycle checks). These are local JavaScript/native mocks, not device proof.
- Backend focused health and safe-error suites: eight passing tests. Existing account-export suite: 22 passing tests.
- Privacy/deletion/community/admin regressions: 61 passed, one failed. The failing `Recipe Manager exposes current and future weekly scheduling` assertion also fails against an untouched HEAD baseline. No unrelated UI/test assertion was changed to hide it.
- Isolated PostgreSQL: seven passing test results (parent plus six cases), including actual repository recipe/workout RLS with fixture entitlements, actual community visibility functions, inherited grants, owner checks, six owner-run wrapper dependencies, corrections/manual preservation, two independent-connection disconnect/upload orderings and owner-cascade deletion.
- The isolated database is an affected-object fixture, not a complete production clone. Its Auth/entitlement and `net` boundaries are controlled fixtures. Full production policies, cron HTTP delivery, native permission behaviour and provider interoperability remain unverified.
- Mobile TypeScript passes. Backend `tsc --noEmit --incremental false -p tsconfig.app.json` reports 24 errors; normalized diagnostics match an untouched HEAD baseline exactly. No new diagnostics. The separate Next production build succeeds; that does not negate the explicit TypeScript project's failures.
- Next build and Expo iOS JavaScript/Hermes export pass. No TestFlight/Android release build or real-device verification was performed.
- Secret-pattern scan: 503 backend and 386 mobile source files at scan time; no matches. Client artifact scan: 39 website files (4,736,202 bytes) and two mobile files (6,798,137 bytes); no matches for scanned secret patterns or locally configured privileged-secret literals. This is bounded evidence, not a guarantee of absence. Actual deployed/release artifacts were not obtained.

Source evidence confirms export includes `sleep_logs`, `body_metrics` and integration metadata, while excluding integration tokens (`20261118161000_account_export_capture.sql`). No new persistent health table was added. Existing deletion handles native integration links explicitly and imported rows use owner cascades. Local cascade tests do not establish live backup erasure or external-provider deletion.

Production evidence reused from the audit: supplied grants/net findings and six postgres-owned wrappers; read-only scoring configuration showed Dad Score v1, Mind v2, Body/Bond v3. Live workout-policy reconciliation was not available through the read-only REST interface. For that reason workout helper execution was preserved, not restricted based on incomplete evidence.

## Remaining calendar/data decisions

The existing native importer stores an account-day label as UTC midnight in `body_metrics.recorded_at`, while scoring filters by timezone-aware instants. Around western timezone/week boundaries those representations can disagree. Profile timezone also need not equal the canonical historical scoring timezone after scheduled changes. Fixing the representation safely requires a separately reviewed historical migration/calendar contract; this patch does not reinterpret saved history or alter scoring.

Proposed follow-up: introduce an explicit local-date/calendar version for imported daily totals, resolve the canonical effective timezone per day, migrate only provably mapped historical native totals, and make scoring read that representation. Keep manual timestamps and immutable weekly reports unchanged. Define ambiguous historical treatment before migration. Do not simply subtract an offset from every existing timestamp.

No new cross-provider source precedence or retention rule is implemented. Native providers can still replace another imported provider according to existing behaviour; manual records are protected. Apple cannot prove deletion from an entirely empty read. Corrections beyond the existing reconciliation window remain outside this patch. Workouts with pause intervals need a separate validated duration/overlap contract before changing existing aggregation. These limitations must not be described as fully reconciled history.

## Device acceptance

1. Use a real health-enabled build. Connect separately with each supported permission; deny a type and confirm its history remains intact. Apple authorization completion is not proof of read access.
2. Start a sync as A; switch to B/logout/disconnect during native reads and during upload. Verify no A values appear under B; reconnect uses a new connection. Repeat A/B/A.
3. Import identical totals twice; correct a supported record; delete one within the reconciliation window. Confirm no duplicate rows, same-provider sleep deletion only, manual values unchanged.
4. Interrupt network/profile reads and one native data type. Confirm failure is truthful and last successful sync is not advanced. Retry once connectivity returns.
5. Exercise partial Health Connect permissions and revoke during a pending read. Confirm revoked data is not uploaded.
6. Verify London DST and a western-zone week boundary; record the known calendar mismatch rather than accepting it as fixed.
7. Export a synthetic account, inspect health totals and token exclusion, then delete that test account through the existing confirmed flow. Verify another account remains intact.
8. Check logged-out community, weekly recipe and workout browsing; Free versus Pro access; private circles, blocked authors and anonymous posts; native sync status wording.

## Existing versus proposed scoring example — proposal only

Synthetic seven-day inputs: six qualifying check-ins; steps `[6000,10000,4000,8000,5000,12000,7000]`; workout minutes `[30,0,20,0,45,0,0]`; sleep hours `[7,6,8,7,6,8,7]`. No app workout-session or other manual activity records in this example.

Existing audited Body/Bond v3 calculation: check-ins contribute 60. The health pool contribution is `0.3 × (averageSleep/8 × 30 + averageSteps/10000 × 20 + averageActiveMinutes/30 × 10)`, giving approximately **73.69** for these inputs. This example is not a proposed production score change.

Proposed four-unit daily model: movement `2 × min(1, max(workoutMinutes/30, steps/10000))`; sleep `2 × min(1, sleepHours/8)`. Movement uses the greater normalized measure, not their sum, so the same walk/workout cannot earn the movement allowance twice. The example gives 24.5833 weekly units; with 60 check-in points plus `30 × units/28`, approximately **86.34**. Thresholds, weights, manual equivalence and interaction with existing app workouts require approval. Manual logging must retain a route to the full score; connecting a device should reduce effort, not increase the cap.

## Health data and policy wording for review

Native reads: steps, workout intervals/duration and sleep intervals. Raw records are processed transiently on device; daily step counts and active minutes are uploaded to `body_metrics`, sleep hours/date to `sleep_logs`. Owner, source and timestamps identify those totals. Integration metadata records provider/connection/sync time; native connections have no OAuth access/refresh token. Existing Fitbit/Garmin paths retain their existing token handling and resting-heart-rate functionality; they were not removed.

Suggested narrowly accurate wording: “If you connect Apple Health or Health Connect, Dad Health reads the health data types you permit to calculate daily steps, workout minutes and sleep hours. We store daily totals linked to your account rather than the underlying native health records. You can stop future imports by disconnecting in Dad Health or changing device permissions. Disconnecting does not delete totals already saved. Those totals are included in account export and removed through account deletion, subject to the separate backup and legal-retention disclosures.”

No new health retention period is approved. Current history remains until account deletion; a finite retention period would require a product decision and an implementation covering exports/backups. Do not promise that all app-entered health information never reaches another service: separate meal-plan/free-text features require their own accurate disclosure. No health analytics integration was added.

## Separate future health milestone and Google prerequisites

Planning estimate, not a price or delivery commitment: 2–3 working days for an approved scoring/calendar/manual-equivalence contract and database implementation; 2–3 days for native corrections/UX; 2–3 days for physical iPhone/Android/provider acceptance and disclosure preparation. Roughly 6–9 working days after decisions and access, with overlap possible. Store review, Google verification and third-party device availability are external elapsed time. A separate fee must be agreed; this remediation does not set or change it.

Provide app-scoped Play Console access for the developer to inspect app content, Health apps/Data safety declarations and an agreed testing track; grant release permissions only if release work is authorised. Keep owner/admin access with the owner. Confirm the package/application ID and access to the existing EAS project/signing configuration. Use the existing upload key securely, or an owner-approved upload-key reset if lost; do not share passwords in chat or regenerate signing material casually. Google holds the distribution app-signing key when Play App Signing is enabled.

Health Connect permissions in the manifest must match the declared read types; provide the privacy policy and permission rationale/access activity, complete Health apps and Data safety disclosures, and validate the signed build on supported Android versions. Do not request write, background or RHR permissions for the native scope. Business verification/store approval can block publication even when local development works. No new Google account-wide access or credentials are required just to write the local code.

Official references checked 26 November 2026:
- https://developer.android.com/health-and-fitness/health-connect/publish
- https://developer.android.com/health-and-fitness/health-connect/get-started
- https://support.google.com/googleplay/android-developer/answer/9842756

Apple Watch/Garmin interoperability still needs representative devices and confirmation that the requested data types actually reach Apple Health/Health Connect. Do not promise every Garmin data type/platform path from repository inspection alone.

Read-only post-install checks: `supabase/tests/security_health_verify_readonly.sql`. This file deliberately excludes worker commands and request payloads.

## Exact changed-file inventory

E:/client-projects/dadHealth

- `E:/client-projects/dadHealth/package-lock.json`
- `E:/client-projects/dadHealth/package.json`
- `E:/client-projects/dadHealth/src/app/api/admin/[resource]/route.ts`
- `E:/client-projects/dadHealth/src/app/api/admin/happenings/route.ts`
- `E:/client-projects/dadHealth/src/app/api/admin/happenings/upload/route.ts`
- `E:/client-projects/dadHealth/src/app/api/admin/upload/route.ts`
- `E:/client-projects/dadHealth/src/app/api/admin/weekly-recipe/route.ts`
- `E:/client-projects/dadHealth/src/app/api/admin/weekly-workout/route.ts`
- `E:/client-projects/dadHealth/src/app/api/auth/biometric/device/route.ts`
- `E:/client-projects/dadHealth/src/app/api/auth/biometric/exchange/route.ts`
- `E:/client-projects/dadHealth/src/app/api/generate-meal-plan/route.ts`
- `E:/client-projects/dadHealth/src/app/api/generate-workout/route.ts`
- `E:/client-projects/dadHealth/src/app/api/notifications/dispatch/route.ts`
- `E:/client-projects/dadHealth/src/app/api/pro/insights/route.ts`
- `E:/client-projects/dadHealth/src/app/api/stripe/checkout/route.ts`
- `E:/client-projects/dadHealth/src/app/api/stripe/portal/route.ts`
- `E:/client-projects/dadHealth/src/app/api/stripe/subscription/route.ts`
- `E:/client-projects/dadHealth/src/app/api/stripe/sync-checkout/route.ts`
- `E:/client-projects/dadHealth/src/app/api/stripe/webhook/route.ts`
- `E:/client-projects/dadHealth/src/utils/supabase/admin.ts`
- `E:/client-projects/dadHealth/supabase/functions/wearable-sync/index.ts`
- `E:/client-projects/dadHealth/tests/fitnessHealth.test.mjs`
- `E:/client-projects/dadHealth/tests/healthConnect.test.mjs`
- `E:/client-projects/dadHealth/docs/security-health-remediation.md`
- `E:/client-projects/dadHealth/src/lib/safeError.ts`
- `E:/client-projects/dadHealth/supabase/migrations/20261126120000_security_least_privilege.sql`
- `E:/client-projects/dadHealth/supabase/migrations/20261126121000_health_sync_boundaries.sql`
- `E:/client-projects/dadHealth/supabase/tests/security_health_assertions.sql`
- `E:/client-projects/dadHealth/supabase/tests/security_health_fixture.sql`
- `E:/client-projects/dadHealth/tests/safeError.test.mjs`
- `E:/client-projects/dadHealth/tests/securityHealth.database.mjs`

E:/client-projects/dadhealth-mobile

- `E:/client-projects/dadhealth-mobile/hooks/useAppleHealth.ts`
- `E:/client-projects/dadhealth-mobile/hooks/useHealthConnect.ts`
- `E:/client-projects/dadhealth-mobile/lib/appleHealth.ts`
- `E:/client-projects/dadhealth-mobile/lib/healthConnect.ts`
- `E:/client-projects/dadhealth-mobile/lib/healthSyncCore.ts`
- `E:/client-projects/dadhealth-mobile/tests/healthConnect.test.mjs`
- `E:/client-projects/dadhealth-mobile/tests/nativeHealthSync.test.mjs`
- `E:/client-projects/dadhealth-mobile/lib/healthTransport.ts`
- `E:/client-projects/dadhealth-mobile/tests/healthConnectLifecycle.test.mjs`
- `E:/client-projects/dadhealth-mobile/tests/healthTransport.test.mjs`

- `E:/client-projects/dadHealth/supabase/tests/security_health_verify_readonly.sql`
