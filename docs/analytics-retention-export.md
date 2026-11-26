# Current retention/export status - 26 November 2026

See [analytics closeout](item06-analytics-closeout.md) for current implementation, migrations and acceptance blockers. Owner-filtered SQL-file export is implemented locally behind a durable default-off gate. Provider capability remains unverified. Delivery and job 32 stay paused. User reports mobile activation and ingestion now working after environment corrections; the historical 503 is not treated as a current code defect.

The following is the historical 21 November design/isolation record. Statements that runtime integration or its adapter are absent are superseded. The retention decision and privacy limitations still apply.

---

# PostHog retention and account-export compatibility

Decision recorded 2026-11-21: retain existing EU project **162656** on **Free**, with its one-year event-retention window. No paid upgrade. This decision does not activate delivery. Keep `ANALYTICS_DELIVERY_ENABLED=false`, and keep job 32 inactive pending review. The earlier registration HTTP 503 has no confirmed cause. Read-only checks on November 21 found successful grant RPC responses and a valid test-account consent; fresh device ingestion acceptance remains pending. Do not change registration based on the historical failure alone.

**Remote export rollout is blocked and isolated.** The unfinished implementation, migration, tests and integration patch are preserved as inert files in [the development proposal](proposals/remote-analytics-export/README.md), outside runtime source, automatic tests and `supabase/migrations`. The active `processExport` and its existing tests match HEAD exactly. The remaining backend changes can be checked/deployed independently; they neither add remote export coverage nor depend on the proposal's SQL. Existing JSON/PDF/email export retains its current coverage, which is not complete retained PostHog coverage.

The sections below describe the inactive proposal and its earlier evidence, not the deployed export path. Its interactive `/query/` bulk reader was removed. The proposed engine has no production event adapter: it fails closed with `analytics_export_capability_required`. Its internal reader is a fixture seam, not a completed integration.

## Capture and export contract

The archived integration proposed calling `captureRemoteAnalytics` after the existing immutable Supabase capture. That call is **not in active `processExport`**. In the proposal, the account comes from the accepted operation. The project and EU API host are validated; no client supplies them.

- Resolve profiles using the verified Auth UUID as `distinct_id`. Follow only same-project provider pagination with the same owner filter. Include linked legacy distinct IDs; never search by guessed email or display name. Alias graphs containing another current or deleted Dad Health owner fail closed.
- Required adapter contract: read every retained matching event at or before the local capture timestamp. Do **not** apply a one-year lower cutoff: expired events may still exist at the provider. The local capture engine validates ordered UUID pages (100 records plus lookahead), original timestamps, complete event properties and provider profile fields. Unknown/null values remain null. This contract is tested with controlled fixtures, not live bulk-export access.
- Stage pages and the traversal state atomically in private tables with lease/owner/deletion checks and revision compare-and-swap. Lost acknowledgements resume the committed cursor. Provider failure never becomes an empty successful section.
- A second full traversal must produce the same canonical event digest/count, and profiles must match. Differences restart only remote staging, preserving the original capture cutoff. Two rebuilds are permitted; further changes fail without finalization. Profile-page cursors, visited links and accumulated profiles are checkpointed after each page in both traversals. The export reports the local capture time and remote observation interval: PostHog and Supabase do not share a transaction. Events arriving at PostHog after that observation are not claimed to be included. Locally captured pending/uncertain events remain in the export even when the provider has no copy yet.
- Merge matching event IDs once, preserving the full local record as `localCapture` on the remote record. Conflicting remote UUID copies fail rather than silently dropping values. Unmatched local events remain included.
- Only finalization unlocks downloads/email. Both PDF and JSON consume the same completed artifact. Previously handed-off artifacts/presentation bytes remain unchanged and may lack the new remote coverage; use a fresh export for acceptance.
- Private staging cascades with the existing 24-hour artifact expiry/deletion cleanup. No new long-lived event archive is added. Finalization removes duplicate staged event rows. Worker memory is one page, not the whole export; final JSONB assembly uses the existing database artifact architecture and therefore adds database I/O proportional to the provider dataset.

Limits requiring honest handling: PostHog documents SQL file exports as organization-enabled closed beta; project access alone does not establish availability. Capability is unverified, not proven unavailable. Identity graphs exceeding 20 profile pages require review and fail closed. Worker event memory is page-bounded; accumulated profile metadata grows across up to 20 pages. Two matching reads detect observed mutation but are not a provider snapshot isolation guarantee. Late ingestion after verification cannot be predicted. Historical browser identities without a provider link to the verified UUID cannot safely be attributed and are not guessed. Raw recordings are not introduced as export attachments by this change.

## Setup / installation (operator review only)

1. **Do not apply:** `proposals/remote-analytics-export/20261121120000_account_export_remote_analytics.sql.disabled` is preserved outside the migration directory. After provider adapter completion and separate approval, a reviewed forward migration would follow existing privacy/export and analytics objects. The proposal creates private staging tables, lease-protected capture functions, bounded restart and completion guards. No migration was applied to production. Production analytics objects are installed even though their three migration versions are not recorded; do not rerun foundation SQL blindly.
2. Future reintegration must coordinate matching code and SQL: the proposal's completion guard would block unhanded-off exports until enrichment finishes. It is intentionally absent from the current deployment candidate. Existing handed-off exports must remain immutable.
3. Verify the existing EU project capability before implementing its adapter. Management-key project access and SQL-export organization enablement are separate. No local management credential or connected authenticated PostHog session was available for read-only inspection. The documented SQL-file-export API has no dashboard UI or documented capability-only endpoint. In the signed-in dashboard, select project 162656 and check an existing support confirmation of organization enablement; if none exists, the user can ask in-app support whether `model: hogql` file download exports are already enabled, without requesting activation or a paid plan. Do not click Run/Create export as a capability test. Existing deletion permissions remain required independently of rollout flags.
4. Existing authenticated privacy worker processes export pages; provider calls fail closed if credentials are missing. Do not send real exports during local review.
5. To run **only local retention/recovery**, review `supabase/analytics-maintenance-scheduler.sql`. Deploy the maintenance handler first; separately approve installing the script, then separately approve activation. It uses the existing Vault URL/secret, validates the delivery URL, and POSTs only to the fixed maintenance endpoint with Bearer authentication. The hourly job starts inactive. This handler has no claim/delivery path. It runs `cleanup_optional_analytics` and `recover_analytics_actions` even while delivery is paused. Keep job 32 inactive. Privacy cleanup keeps its existing schedule. Rollback: unschedule only `optional-analytics-maintenance` and drop only `public.invoke_analytics_maintenance()`; do not alter delivery/privacy jobs.
6. Keep remote delivery disabled. Choosing Free retention does not resolve the registration 503 or establish provider/device acceptance.

## Privacy wording for review

> If you choose optional analytics, we use PostHog in the EU to understand how Dad Health is used. Our PostHog Free project has a one-year event-retention window, measured from an event's timestamp. Expired events are removed through PostHog's scheduled deletion process, not necessarily on the exact anniversary; backup copies can remain for the provider's backup-retention period.
>
> Person profiles have a separate lifecycle and do not automatically expire with events. Account deletion includes verified cleanup of linked analytics data. Session recordings are not enabled by our current analytics integration. If historical recordings exist, their retention is separate; deleting a linked account requests removal of its linked recordings as well.
>
> Turning analytics off stops future collection and delivery of unsent optional events. It does not erase events already sent to PostHog. You can request an account export or account deletion through Settings. Exports include retained information that can be linked securely to your account, with collection times explained in the export.
>
> On our systems, unsent optional events expire after seven days from occurrence and delivery records after thirty days from their local creation time. Cleanup runs periodically. Minimal deduplication and deletion-safety records have separate purposes and lifetimes; credential expiry is not an event-retention period.

Do not claim historical recording absence, complete legacy identity mapping, or an exact one-year physical deletion guarantee without provider evidence.

## Evidence and pending acceptance

Official references checked 2026-11-21:
- https://posthog.com/docs/data/events-retention (Free one year; timestamp-based expiry).
- https://posthog.com/docs/privacy/data-storage (profiles, recordings, deletion delays and backups).
- https://posthog.com/docs/api (pagination, private API access).
- https://posthog.com/docs/data/persons (identified profiles and linked anonymous identities).
- https://posthog.com/docs/data-pipelines/file-download-exports (query API is not a bulk export facility; dedicated SQL file export is closed beta, so this implementation does not assume access or add a paid service).

Required later checks: fresh test-account PDF/JSON agree; identifiable legacy events/profile appear; a retained provider event missing locally appears; withdrawal does not call remote deletion; a provider outage prevents success; expiry and account deletion block both downloads; provider deletion remains required for unknown/possible exposure even with delivery off. Check real provider pagination/query format and large-account resource limits before rollout. No live-provider or device verification is claimed.
## Earlier local verification (before the November 21 blocker follow-up)

- `node --test tests/analyticsRemoteExport.test.mjs tests/analyticsFoundation.test.mjs tests/analyticsConsentBoundaries.test.mjs tests/accountDeletion.test.mjs`: initial combined run 53 passed. After adding two more remote identity/pagination cases and strengthening maintenance flags, the changed suites were rerun: 28 passed (9 remote-export + 19 foundation). The unchanged consent/deletion suites account for the other 27 cases; 55 distinct passing cases in total, not 81 independent tests.
- `node --test --test-name-pattern='^(?!PDF generation propagates)' tests/accountExport.test.mjs`: runner executed all 23 tests successfully, including the cancellation and real large-PDF fixture. Large fixture: 7,494,000 input bytes, 2,802 pages, 84,242,616-byte measured peak heap. Runtime approximately 148 seconds. The three targeted email/pending/large-worker cases also passed separately.
- `ANALYTICS_EXPORT_TEST_CONTAINER=dadhealth-analytics-export-local-20261121 node --test tests/analyticsRemoteExportDatabase.test.mjs`: passed one real PostgreSQL integration scenario with multiple assertions, including independent-connection deletion lock contention. The database is created/dropped per run and uses the existing privacy table/function definitions plus the new migration; this is not a full production-schema replay.
- Backend TypeScript and Git diff whitespace checks passed. No mobile implementation changed.

Provider responses in Node tests are controlled fixtures. PostgreSQL tests do not contact PostHog. Project permission checks, actual legacy linkage, API quotas, migration deployment and device/end-to-end acceptance remain pending. The production 503 is not reported fixed.
