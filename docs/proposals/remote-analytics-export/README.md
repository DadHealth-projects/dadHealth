# Remote analytics export — inactive development proposal

Not runtime code, not an installable migration and not provider-verified.
Do not rename/copy these files into active directories as part of deployment.

The current production candidate deliberately preserves the existing immutable
Supabase JSON/PDF export, verified email destination, download restrictions,
idempotency and deletion coordination. It does **not** claim complete export of
retained PostHog events/profiles, including identifiable legacy website data.
Remote delivery must remain disabled pending that coverage and acceptance.

## Preserved files

| Snapshot | Original development path |
| --- | --- |
| `export-analytics.ts.txt` | `src/lib/privacy/export-analytics.ts` |
| `20261121120000_account_export_remote_analytics.sql.disabled` | `supabase/migrations/20261121120000_account_export_remote_analytics.sql` |
| `analyticsRemoteExport.test.mjs.txt` | `tests/analyticsRemoteExport.test.mjs` |
| `analyticsRemoteExportDatabase.test.mjs.txt` | `tests/analyticsRemoteExportDatabase.test.mjs` |
| `integration.patch` | Proposed changes to `src/lib/privacy/export.ts` and `tests/accountExport.test.mjs` |

The four moved files were SHA-256 checked before/after moving. The patch preserves
the removed integration and its pending/failure assertion. Snapshots intentionally
retain their original imports/test paths; they are development references, not
runnable tests from this directory. The active export file and its original test
file were returned to their exact HEAD contents by removing only this integration.

## Work required before reintegration

1. Verify owner-filtered bulk SQL export capability for EU project 162656. Project
   access alone is insufficient. Do not use interactive `/query/` for bulk export
   or export the entire project. No paid upgrade is approved.
2. Implement the supported asynchronous adapter, durable provider run/file
   cursors, safe signed downloads and bounded work. The supplied event-reader
   seam is currently fixture-only; absent a reader the proposal fails closed.
3. Retest profile pagination, lost responses, changes during verification,
   bounded rebuilds, owner isolation, local/remote deduplication, failure recovery,
   expiry and deletion races. Preserve already handed-off export bytes.
4. Reassess database I/O for final JSONB assembly; do not promise constant database
   memory or I/O. Complete real provider acceptance with an approved test account.
5. Obtain separate review/approval for reintegration, deployment and forward SQL.
   Allocate/review a migration version then; this old proposal is not an instruction
   to apply it. No SQL from this directory belongs in routine migration rollout.

Earlier fixture/isolated-PostgreSQL results remain documented in
[`../../analytics-retention-export.md`](../../analytics-retention-export.md).
They do not establish live provider completeness or deployment readiness.
