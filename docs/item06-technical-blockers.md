# Item 06 technical follow-up — 2026-11-21

## Scope and status

Local implementation and isolated tests only. No production mutation, provider
export, email, deployment, commit, scheduler activation or remote delivery.
Item 06 is not complete. Preserve accepted onboarding, report and privacy flows.

Handoff correction: the unfinished remote-export source, migration and tests
listed below have since been moved unchanged to inert snapshots under
`docs/proposals/remote-analytics-export/`. The active export execution and original
tests now match HEAD exactly. Original paths in this report describe the earlier
development checkpoint, not files to deploy/apply. See
[the current deployment handoff](item06-backend-handoff.md) for the exact file list
and verification. Existing export coverage is preserved, not expanded to complete
remote PostHog coverage.

## Read-only production evidence

- The seven analytics tables and their expected source-action/privacy triggers
  are installed. The three `20261120` analytics migration versions are not in
  the migration history. Do not replay the foundation migrations to repair that
  history without a separate reconciliation review.
- At 09:30 UTC, the approved test account had seven consent rows: six revoked
  and one unexpired, expiring December 21. At 09:24 UTC it had zero outbox rows.
  These aggregate facts do not identify this device's capability.
- The inspected last-day gateway metadata included seven successful grant RPC
  HTTP responses and no evidenced failing consent SQL statement. RPC transport
  success is not proof of mobile response validation or accepted event delivery.
- The fresh device report still shows saved ON consent with failed readiness.
  The earlier 503 cause is unconfirmed, not repaired by assumption.
- Public website HEAD returned 200 with a Vercel deployment header but no commit
  SHA. No authenticated Vercel metadata access was available: deployed SHA unknown.
- Job 32 remains inactive. No maintenance-only job exists. The privacy and
  moderation jobs remain active; cron enqueue success does not prove HTTP worker
  completion. Their recent failures need their own response evidence.
- Remote-export staging and its begin RPC are absent. The pending remote-export
  migration remains unapplied and is NOT ready for rollout.
- Dad Days installed budget/age constraints match current request allowlists.
  The approved test account had no persisted searches. No matching provider
  failure evidence was available: insufficient API credits is not a diagnosis.

## Changes made in this follow-up

| File | Change / verification |
| --- | --- |
| `../dadhealth-mobile/lib/analyticsQueue.ts` | A transient storage-read failure no longer replaces the persistent queue with empty state. Readiness joins in-flight credential verification. Missing/expired credentials never regrant from a preference. Safe status metadata contains no IDs/secrets. |
| `../dadhealth-mobile/lib/analytics.ts` | Settings status reconciles only an existing unexpired credential and waits for its result; reports the effective enabled flag without logging it. |
| `../dadhealth-mobile/tests/analyticsFoundation.test.mjs` | Storage-read failure/restart regression; other-owner data and original queued identity preserved. |
| `../dadhealth-mobile/tests/analyticsConsentRegistration.test.mjs` | In-flight renewal, failed renewal, expired/different-owner capability regressions; no grant from saved choice, no client logs. |
| `src/lib/privacy/export-analytics.ts` | Removed unsupported interactive bulk query; isolated the missing production adapter. Profile pagination checkpoints both traversals; changed-data verification can restart bounded remote staging. |
| `supabase/migrations/20261121120000_account_export_remote_analytics.sql` | Unapplied proposal only: lease/CAS-protected restart, unchanged cutoff, maximum two rebuilds, counter preservation. No changes to already installed analytics migrations. |
| `tests/analyticsRemoteExport.test.mjs` | Fixture traversal/restart/lost acknowledgement/bounded rebuild/fail-closed adapter tests. These are not provider acceptance. |
| `tests/analyticsRemoteExportDatabase.test.mjs` | Real SQL restart/CAS/counter/immutable handoff and deletion-lock tests. |
| `supabase/analytics-maintenance-scheduler.sql` | Review-only hourly authenticated POST setup, initially inactive; existing jobs untouched. |
| `tests/analyticsMaintenanceScheduler.test.mjs` | Real PostgreSQL scheduler/permissions tests with fake Vault values and recording-only network function. No external request. |
| `tests/nativeSubscriptions.test.mjs` | A source assertion ignores comments when checking that publication time does not replace verified-state time. |
| `docs/analytics-retention-export.md` | Corrects rollout claims, provider dependency, resume/rebuild semantics and operator setup. |

Existing changes from earlier work remain in both trees; this is not a list of
all pending Item 06 files.

## Executed checks

- Mobile focused analytics/consent/funnel/onboarding/Dad Days: **48 passed**.
  The new storage and readiness regressions were observed failing before fixes.
- Backend analytics/consent/funnel/deletion/native-subscription/Dad Days:
  **104 passed, 1 pre-existing blocked test**. The blocked test is
  `entitlement and lifecycle claims remain concurrency safe and idempotent`:
  it reads absent `supabase/migrations/20260820120000_native_subscriptions.sql`.
  Do not fabricate that historical migration or weaken its assertions.
- Focused export compatibility: **8 passed**, including real PDF/JSON generation,
  immutable retries/legacy handoff, wrong-owner/expiry/deletion guards and
  incomplete remote capture preventing email authorization.
- Real local PostgreSQL foundation/funnel: **19 passed**. Includes independent
  ingestion and first-action contention, rollback, renewal/withdrawal/expiry,
  deletion-versus-delivery, exposure, timezone/DST and historical suppression.
- Real local PostgreSQL remote-export integration: **1 passed**, multiple
  assertions including independent deletion-lock contention and restart revision.
- Real local PostgreSQL maintenance setup: **1 passed**. No worker HTTP was sent.
- Backend and mobile TypeScript passed; tracked diff checks passed before the
  final documentation update. Provider tests use fixtures, not live acceptance.

## Provider and product dependencies

PostHog project access is not evidence of organization SQL-file-export access.
No local management credential or connected authenticated PostHog session was
available. Official documentation describes `model: hogql` exports as an
organization-enabled closed beta and API-only, with no documented read-only
capability probe. Do not POST an export to test access, or substitute project-wide
exports. In project 162656, check existing organization support correspondence
for explicit SQL-file-export enablement; otherwise the user must obtain that
confirmation through in-app support. No paid activation is authorized.

Once confirmed, implement the documented asynchronous owner-filtered adapter,
including durable run/file cursors, signed-download handling, bounded reads and
completeness acceptance. The current internal fixture reader is NOT this adapter.
Do not deploy the remote-export changes or apply the pending migration before it
is finished. The existing database-backed artifact architecture still assembles
final JSONB in PostgreSQL; its dataset-dependent I/O has not been benchmarked.

Separate account-level background-billing consent scope was approved for a LATER
implementation. Collection stays suppressed; no new consent UI or account-wide
inference was added. The 50% offer is still a separate product/provider decision.
Profile/legacy-recording retention and deletion timing remain distinct from the
approved one-year event window. Current code does not enable recordings.

## Production proposal — maintenance only, separate approval required

1. Review/deploy the existing maintenance endpoint and its dependencies.
2. Separately approve applying `supabase/analytics-maintenance-scheduler.sql`.
   It uses existing Vault entries, creates an inactive hourly job and makes no
   request during installation. Do not alter job 32 or the privacy scheduler.
3. Check the safe metadata below. Only after endpoint/configuration review,
   request separate approval to activate the maintenance job.
4. Rollback only this setup: unschedule `optional-analytics-maintenance`, then
   drop `public.invoke_analytics_maintenance()`. It creates no data tables and
   does not change existing delivery/privacy behavior.

```sql
-- Read-only; reveals neither Vault values nor cron command text.
select jobid, jobname, schedule, active
from cron.job
where jobname in ('optional-analytics-worker','optional-analytics-maintenance');
select to_regprocedure('public.invoke_analytics_maintenance()') is not null
  as maintenance_wrapper_installed;
select p.proname, p.prosecdef, p.proconfig,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as user_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='invoke_analytics_maintenance';
```

## Next focused device check

Reload the current mobile JavaScript, leave the existing ON choice unchanged,
then leave/reopen Privacy & Security while online. No new grant is made from
the preference. A valid pending renewal is awaited; failed renewal remains an
honest readiness failure. If it still fails, in React Native DevTools pause at
the return in `getAnalyticsConsentStatus` and inspect only the watch expression
`({ ...state, enabled: enabled() })`: granted, ready, credentialState, enabled.
Do not inspect/copy raw AsyncStorage, scopes, owners, request bodies or headers.
For a visible failed analytics network request, share only status and response
`X-Analytics-Failure-Code` / `X-Analytics-Request-ID` (not Authorization).
Missing or expired credentials need a separate explicit OFF/ON choice; do not
reset storage or assign another server consent to this device.

After readiness passes, cold reopen once and check only the approved test
account's new event names/timestamps/counts, never properties. Device/provider
acceptance remains pending until that succeeds. For Dad Days, use one new search
and its fixed failure code/request ID to obtain the matching server/provider
stage; do not infer quota exhaustion from a generic failure.
