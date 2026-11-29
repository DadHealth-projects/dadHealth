# Item 06: local analytics implementation — 26 November 2026

Local code and fixture verification only. No production SQL, environment changes, provider operations, email, scheduler activation, deployment, commit or push performed. Keep remote delivery disabled and job 32 inactive. Existing tested mobile consent registration and ingestion were preserved. Item 06 is **not** end-to-end accepted.

## Implemented behaviour

### Remote export

`processExport` preserves the existing local JSON/PDF path by default. `ANALYTICS_REMOTE_EXPORT_ENABLED=true` selects enrichment for a new, not-yet-handed-off operation. That selection is checkpointed: switching the flag off cannot turn a pending remote export into a successful local-only export. Existing handed-off bytes remain immutable. The default path does **not** claim full retained PostHog coverage.

The new reader uses PostHog's documented owner-filtered HogQL **file download export** API, not interactive `/query/` bulk retrieval or a project-wide export. It verifies EU project 162656, resolves only provider identities linked to the verified owner, checks aliases against other current/deleted Auth owners, and persists provider runs, file positions, profile cursors and event cursors. No email/name guessing. Nulls, original timestamps and complete properties are retained. Local/remote duplicate UUIDs merge with the full local record retained as `localCapture`.

Two matching event traversals and a repeated profile traversal are required. Changed data rebuilds remote staging at the original local cutoff, at most twice. Further changes fail visibly. Provider failures, malformed pages and insufficient permissions never become empty successful sections. Completion gates downloads and email. Supabase/PostHog do not share a transaction: the artifact records the observation interval and does not promise inclusion of later arrivals.

Processing is page-bounded, resumable through the existing privacy worker. Large pages halve their keyset size; an irreducible page above 16 MiB fails rather than truncating. Profile discovery is bounded to 20 pages; oversized/ambiguous identity graphs require review. Final database JSONB assembly still incurs memory and disk I/O proportional to the complete account dataset; this is not a constant-memory database implementation. Staging follows existing artifact expiry/deletion, with no new permanent remote-event archive.

PostHog SQL file exports require organization enablement. A Personal API key or project access alone does not prove this capability. It remains **unverified** here. Lost create acknowledgements can leave an extra owner-scoped provider export job; no undocumented provider idempotency is assumed. Provider export files expire according to PostHog's documented one-week lifecycle. Signed URLs are never logged and never receive the management key.

### Separate billing consent

Privacy & Security now has a separate, optional account-level subscription-analytics switch. It defaults off and is independent of device usage consent. Reads/writes authenticate the owner server-side. Revision checks and stable operation IDs handle duplicate taps, lost responses and concurrent changes. Failed saves do not display success; foreground/focus reads reconcile uncertain changes without automatic repeated writes. Account switches discard stale results. Session lookup and requests are bounded; no analytics action delays subscription processing.

`ANALYTICS_BILLING_COLLECTION_ENABLED` remains default-off until acceptance. Existing verified billing adapters feed the account-consent RPC; device credentials and the old nullable device-consent argument cannot authorize billing. Only facts after the current account grant can qualify. Cancellation additionally requires the previous verified state to fall within the same grant window, avoiding a retrospective inference from a delayed cancellation notification. Withdrawal revokes the internal collection scope, prevents future enqueueing and removes unsent data subject to existing in-flight safeguards. No cancellation reason or discount offer is invented.

The private choice is included in export and cascades with Auth deletion. The internal technical credential may be recreated while the explicit account choice remains granted; this does not alter native device credential renewal rules. Existing provider/environment dedupe remains. Optional RPC failures are logged safely and do not reject successful billing. The existing adapters are not a transactional billing-event outbox: a failed analytics call after entitlement persistence may lose a transition. Do not claim lossless billing delivery or fabricate a later replacement event; activation review must accept this measurement limitation or separately approve a durable verified-evidence journal in the shared subscription pipeline.

### Remote deletion and privacy

Erasure checkpoints provider-linked identities before requesting deletion, validates the complete alias graph server-side, pages deletion statuses, and verifies every known alias is absent plus an uncached zero-event count. Acknowledgement alone is not completion. Unexpected new linked identities trigger bounded rediscovery. Missing credentials, unknown exposure, pending provider deletion and ambiguous identities remain unresolved; rollout flags do not bypass erasure. Existing exposure evidence, delivery-lease barriers, storage/Auth/Apple/OneSignal/wearable cleanup remain in place. Successful paging does not consume the failure budget; actual failures remain observable.

Provider-only `$geoip_disable: true` is appended after contract validation. Client overrides are rejected; no client IP is forwarded. Project IP-discard/GeoIP settings still require owner verification. The maintenance-only endpoint still performs local retention/recovery without dispatching events. No schedule was activated.

## Exact implementation map

All paths below are relative to the named repository. Unrelated security/health changes already in the working trees are excluded.

| Repository | File | Purpose |
| --- | --- | --- |
| dadHealth | `src/lib/analytics/billing-consent.ts` | Strict authenticated choice contract |
| dadHealth | `src/app/api/analytics/billing-consent/route.ts` | GET/POST choice, owner validation, rate limit, private responses |
| dadHealth | `src/lib/analytics/billing.ts` | Account consent collection gate and conservative event timing |
| dadHealth | `src/lib/privacy/export-analytics.ts` | Durable verified remote capture and duplicate reconciliation |
| dadHealth | `src/lib/privacy/posthog-export-reader.ts` | Supported owner-filtered provider file API |
| dadHealth | `src/lib/privacy/export.ts` | Durable opt-in integration; original handoffs preserved |
| dadHealth | `src/lib/analytics/privacy.ts` | Resumable alias/status erasure verification |
| dadHealth | `src/lib/privacy/deletion.ts` | Alias validation and successful-progress retry accounting |
| dadHealth | `src/lib/analytics/service.ts` | GeoIP suppression and redirect protection |
| dadHealth | `supabase/migrations/20261126130000_account_billing_analytics_consent.sql` | Private choice, guarded RPCs, export inclusion |
| dadHealth | `supabase/migrations/20261126131000_account_export_remote_analytics.sql` | Private staging, capture CAS, completion gates |
| dadHealth | `supabase/migrations/20261126132000_analytics_identity_guard.sql` | Service-only cross-account alias guard |
| dadHealth | `supabase/tests/analytics_closeout_verify_readonly.sql` | Safe installation metadata check |
| dadHealth | `tests/analyticsClosing.test.mjs` | Provider reader/erasure, billing API, GeoIP and resource ceilings |
| dadHealth | `tests/analyticsRemoteExport.test.mjs` | Restart, changing data, pagination, identity, nulls, duplicates |
| dadHealth | `tests/analyticsRemoteExportDatabase.test.mjs` | Real private staging/grants/completion tests |
| dadHealth | `tests/analyticsFunnelDatabase.test.mjs` | Billing choice SQL, independent-connection races, deletion/export |
| dadHealth | `tests/accountExport.test.mjs` | Existing export fixtures plus pending/failed remote and immutable handoff |
| dadHealth | `tests/analyticsFoundation.test.mjs` | Updated exact-project erasure fixtures |
| dadHealth | `tests/analyticsDeploymentIsolation.test.mjs` | Gated integration instead of old source-absence expectation |
| dadHealth | `tests/analyticsMaintenanceScheduler.test.mjs` | Accept isolated closeout fixture container name |
| dadhealth-mobile | `lib/billingAnalyticsConsent.ts` | Owner-pinned API and strict response validation |
| dadhealth-mobile | `components/BillingAnalyticsConsentControl.tsx` | Separate switch and server-confirmed recovery |
| dadhealth-mobile | `screens/subscreens/PrivacySecurityScreen.tsx` | Existing Settings integration only |
| dadhealth-mobile | `tests/billingAnalyticsConsent.test.mjs` | Ownership, duplicate taps, races, uncertainty, stalled auth |

Documentation updated: this file, `docs/analytics-retention-export.md`, `docs/item06-backend-handoff.md`, and the historical proposal README. Archived proposal source/SQL remain unchanged and must not be installed alongside the new migration.

## Checks actually executed

Backend:

```text
node --test tests/analyticsClosing.test.mjs tests/analyticsFoundation.test.mjs tests/analyticsRemoteExport.test.mjs tests/analyticsDeploymentIsolation.test.mjs tests/accountDeletion.test.mjs tests/analyticsFunnel.test.mjs tests/analyticsConsentBoundaries.test.mjs
79 passed

node --test tests/accountExport.test.mjs
22 existing cases passed before adding two new gate cases
node --test --test-name-pattern="selected remote|handed-off exports" tests/accountExport.test.mjs
2 new cases passed (24 distinct export cases exercised)

ANALYTICS_TEST_CONTAINER=dadhealth-analytics-local-close
ANALYTICS_EXPORT_TEST_CONTAINER=dadhealth-analytics-local-close
node --test tests/analyticsFunnelDatabase.test.mjs tests/analyticsRemoteExportDatabase.test.mjs tests/analyticsMaintenanceScheduler.test.mjs
21 passed
```

The database fixture used a disposable PostgreSQL 15 container, no exposed ports, with source-derived dependency schema. Tests exercised actual independent sessions, advisory-lock contention, stale revisions, rollback, duplicate operations, private function permissions, tombstones and Auth cascade. Cron/HTTP/Vault scheduler dependencies were local stubs; no live jobs or provider calls. This is not proof of compatibility with uninspected production drift.

Existing PDF test generated 2,802 pages from a 7,494,000-byte fixture, output 3,471,010 bytes, measured peak heap 90,409,416 bytes. No repeat of that expensive case was needed for subsequent unrelated edits.

Mobile: `node --test tests/billingAnalyticsConsent.test.mjs tests/analyticsFoundation.test.mjs tests/analyticsFunnel.test.mjs` — **27 passed**. Provider responses and React hooks are fixtures; not iPhone acceptance. `npx.cmd tsc --noEmit --pretty false` passed in both repositories. `git diff --check` passed in both (line-ending warnings only); newly added analytics files also passed a separate trailing-whitespace scan. No remaining failures in these focused checks. Unrelated full suites were not rerun.

## Installation order and rollback

1. Compare installed privacy/analytics function signatures and grants with the migration dependencies, using metadata only. Missing migration history alone does not justify reinstalling existing analytics foundation objects.
2. Apply forward migrations, in order: `20261126130000`, `20261126131000`, `20261126132000`. Do **not** apply archived `20261121120000...sql.disabled`. Existing security/health migrations are a separate workstream, not a reason to overwrite their pending changes.
3. Deploy matching backend after SQL. Deploy the mobile control only after the authenticated choice endpoint is available. Installing these additions does not enable collection or remote export.
4. Leave `ANALYTICS_DELIVERY_ENABLED=false`, job 32 inactive, and new billing/export rollout gates unset/false until acceptance.
5. Existing privacy processing must continue. Review the existing maintenance-only setup separately; it can run retention/recovery while delivery is paused, but installation/activation needs operator authorization.

Rollback means forward repair and turning off **new** collection/export selections. Do not drop consent/staging tables or delete pending operations. An already selected remote export remains gated until resolved; reverting to old runtime code while such operations exist could bypass completion guards. Preserve remote deletion code and identity validation regardless of delivery flags. Existing local export works independently with the new default-off gate, but is not complete remote coverage.

## External setup and acceptance blockers

- Confirm organization-enabled HogQL file-download exports for EU project 162656. Official docs describe closed beta; project access is not enablement. No local management credentials or connected provider session were available to verify it. Obtain existing enablement confirmation from the project owner/support; do not enable paid or project-wide exports.
- Server-only management key: `POSTHOG_API_KEY`; `POSTHOG_PROJECT_ID=162656`; `ANALYTICS_POSTHOG_API_HOST=https://eu.posthog.com`. Verify least-privilege project access for file exports (`batch_export:read`/`batch_export:write`), person reads/deletion status/bulk deletion and the small zero-count query. API permissions are not inferred from key presence.
- Set `POSTHOG_OWNER_SQL_EXPORTS_VERIFIED=true` only after capability evidence. `POSTHOG_EXPORT_DOWNLOAD_HOSTS` must list exact verified provider storage hosts, never a wildcard. Inspect an authorized fixture's signed-download destination without copying the signature or token into logs/docs.
- `ANALYTICS_REMOTE_EXPORT_ENABLED` selects new enriched exports; `ANALYTICS_BILLING_COLLECTION_ENABLED` authorizes billing collection only after the new consent flow is accepted. Existing ingestion/privacy gates still apply. Do not enable either as part of this handoff.
- Verify project autocapture, IP discard, GeoIP transformation and profile lifecycle. User reports vitals/dead clicks/replay disabled; no owner settings were changed or independently verified here. A one-year event window does not expire person profiles. Decide/document profile retention separately if a time-based policy is required.
- Live erasure must prove linked/personless events and any legacy recordings are removed. If the provider needs additional privileges or cannot erase personless records through this flow, keep cleanup pending; do not create a fake person or claim success.
- Full identifiable legacy coverage depends on actual provider links to the account UUID. Unlinked anonymous history cannot safely be guessed. Two matching reads are not a global provider snapshot.
- Review the documented optional billing-loss limitation above before enabling collection. Durable billing journal implementation is now present, but live acceptance remains pending.

## Device/provider checklist (not performed)

1. Existing device usage toggle still activates/intakes while delivery remains paused. Separate billing switch starts off, persists across reinstall/device changes for the same account, and does not change device consent.
2. Grant/revoke, disconnect mid-save, return foreground, rapid taps, and switch accounts. Only confirmed owner state appears; a lost response reconciles without silently granting or repeating a new operation.
3. With separately authorized fixture billing collection, verify post-grant trial/payment/cancellation, pre-grant/delayed suppression, independent withdrawal, provider replay/order and sandbox separation. Subscription processing succeeds during analytics failure.
4. With verified file-export capability, generate a fresh fixture export: enough pages for restart, Unicode/nulls, local/remote overlap, linked legacy profile, changing data and provider outage. Incomplete capture must block both download formats/email; handed-off export bytes stay unchanged.
5. Fixture deletion: never-exposed, unknown, uncertain/in-flight send, linked profiles, paged statuses, late events, revoked provider key. Final completion only after verified cleanup; other accounts untouched.
6. Confirm maintenance-only local expiry/recovery while dispatch remains paused, then separately review dashboard, remote export and erasure before any delivery activation.

## Privacy wording draft — requires owner review before publication

Optional usage analytics and optional account-level subscription analytics are separate choices. Subscription analytics can record verified trial, paid conversion and renewal-cancellation events while the app is closed, only when its account-level choice is enabled. Turning either choice off stops future collection for that choice; it does not erase analytics already sent.

Dad Health uses PostHog in the EU. The selected Free project has a one-year event-retention window; scheduled expiry and provider backup processes mean deletion is not guaranteed on the exact anniversary. Person profiles have a separate lifecycle and do not expire automatically with events. Current integration does not enable session recording; historical recordings, if present, need separate verification and linked deletion. Account deletion includes required linked provider cleanup and does not report final completion while that cleanup is pending. Export coverage includes only identities that can be securely linked and records its observation interval.

Local unsent events expire after seven days and local delivery receipts after thirty days under existing timestamp rules. Credential lifetime is thirty days and does not expire the consent choice. Minimal deduplication/exposure/deletion-safety records have separate lifecycles. No new remote erasure on withdrawal is implemented.

## Provider references checked

- [File download exports](https://posthog.com/docs/data-pipelines/file-download-exports): organization-enabled SQL exports, run lifecycle, JSONLines, signed downloads and file expiry.
- [Persons API](https://posthog.com/docs/api/persons): identity reads, pagination and deletion/status endpoints.
- [Data collection](https://posthog.com/docs/privacy/data-collection): IP and GeoIP are separate controls.
- [Data storage](https://posthog.com/docs/privacy/data-storage): event/profile/recording lifecycles.
- [Capture API](https://posthog.com/docs/api/capture-v1): event UUIDs and person-profile options.

Documentation checked 26 November 2026. Provider permissions, capability, actual deletion and device behaviour remain acceptance checks, not conclusions from these documents.
