# Current handoff status - 26 November 2026

See [analytics closeout](item06-analytics-closeout.md) for current files, three forward migrations and tests. Remote export now has a durable default-off integration and supported SQL-file adapter. Provider capability remains unverified. Keep delivery disabled and job 32 inactive.

The following is the historical 21 November checkpoint. Its HEAD-equality, no-migration and no-runtime-integration statements and commit manifest are superseded; do not use them for current deployment.

---

# Backend handoff for Harsh — 2026-11-21

## Deployment boundary

The unfinished remote-export integration has been removed from the active
`src/lib/privacy/export.ts`. That file and `tests/accountExport.test.mjs` match
HEAD exactly. Existing immutable capture, readable PDF/JSON, email attachment/link
selection, recipient revalidation, idempotency and deletion coordination remain.

This preserves current export functionality. It does **not** establish complete
coverage of retained PostHog events/profiles or identifiable legacy website data.
Keep remote analytics delivery disabled and job 32 inactive. Preserve existing
privacy processing. Do not replace the incomplete remote section with an empty
successful section or claim the export's coverage has expanded.

The remaining executable changes are sanitised analytics failure correlation and
the authenticated maintenance-only route. They use existing installed analytics
RPCs; there is no new migration prerequisite and no remote-export dependency.
Deploying the route does not invoke it or schedule it.

## Exact backend commit manifest

Paths below are relative to `E:/client-projects/dadHealth`. Stage explicit files
only. No commit, staging or push was performed for this handoff.

Deployment changes and regression tests:

```text
src/app/api/analytics/events/route.ts
src/lib/analytics/service.ts
src/app/api/analytics/maintenance/route.ts
tests/analyticsFoundation.test.mjs
tests/analyticsConsentBoundaries.test.mjs
tests/analyticsDeploymentIsolation.test.mjs
tests/nativeSubscriptions.test.mjs
```

Operator-reviewed setup and documentation (SQL is not automatically applied):

```text
supabase/analytics-maintenance-scheduler.sql
tests/analyticsMaintenanceScheduler.test.mjs
docs/optional-analytics.md
docs/analytics-retention-export.md
docs/item06-technical-blockers.md
docs/item06-backend-handoff.md
```

Inactive proposal, safe to commit as a separate development-reference commit:

```text
docs/proposals/remote-analytics-export/README.md
docs/proposals/remote-analytics-export/export-analytics.ts.txt
docs/proposals/remote-analytics-export/20261121120000_account_export_remote_analytics.sql.disabled
docs/proposals/remote-analytics-export/analyticsRemoteExport.test.mjs.txt
docs/proposals/remote-analytics-export/analyticsRemoteExportDatabase.test.mjs.txt
docs/proposals/remote-analytics-export/integration.patch
```

There is no remote-export file left under `src`, `tests/*.test.mjs` or
`supabase/migrations`. The proposal's text/disabled extensions exclude it from
application compilation, test discovery and normal migration discovery. Its
README records original paths and reintegration prerequisites. Do not apply the
patch or rename snapshots during deployment.

Do not add environment files, credentials, local task records, build artifacts,
mobile changes or unrelated working files. The restored export source/test are
unchanged and require no commit. Review `git diff --cached` before committing.

## Verification and limitations

Checks executed for this separation:

- `node --test tests/accountExport.test.mjs tests/accountDeletion.test.mjs tests/analyticsFoundation.test.mjs tests/analyticsConsentBoundaries.test.mjs`: **68 passed**, zero failures/skips, approximately 160 seconds. Includes the full existing export suite, real PDF generation/large bounded-heap fixture, legacy handoff, owner restrictions, email idempotency and analytics/maintenance authentication. No real email or provider operation. The opt-in database tests inside the export file were not enabled in this run.
- `node --test tests/analyticsDeploymentIsolation.test.mjs`: **2 passed**. Runtime source has no remote-export import/RPC dependency; proposal is outside active migration/test discovery.
- `node --test --test-name-pattern='Google RTDN orders verified snapshots' tests/nativeSubscriptions.test.mjs`: **1 passed** for the changed comment-aware source assertion.
- `tsc --project tsconfig.node.json --noEmit --incremental false`: passed.
- `tsc --project tsconfig.app.json --noEmit --incremental false`: **24 errors**. An in-memory TypeScript comparison against HEAD produced the exact same 24 diagnostics and **zero introduced diagnostics**. Files: admin resource route (9), biometric exchange (1), business enquiry (1), Dad Days route (2), Stripe sync-checkout (2), Stripe webhook (6), waitlist (1), AuthModal (1), LegalDocument (1). These existing errors are outside this handoff's changes and were not edited.
- `git diff --check` and new-file whitespace checks passed. The 19-file manifest below/above exactly matches current backend status; no extra/missing paths. Export source and its test match HEAD after normalizing checkout line endings.

**Conclusion:** the remaining backend changes are independent of the unfinished
remote-export proposal and require no new SQL to deploy. This is not a clean
application-build certification: the application TypeScript baseline is red,
and a production build/deployment was not run. Historical results in the
technical-blockers report are not a substitute for these checks.

The full application TypeScript configuration, rather than the empty root
configuration alone, must be used for handoff verification. An unchanged baseline
error is still a limitation; do not call a red application check a passing build.
No production build, deployment, external email, SQL or scheduler activation is
part of this handoff.

## Operator steps

1. Commit reviewed explicit manifests above; push only after the owner authorizes
   that action. Preserve unrelated pending work. No package installation needed.
2. Code deployment needs no new SQL from this change. Verify existing analytics
   RPC availability using existing read-only metadata checks; do not replay
   foundation migrations simply because migration history is incomplete.
3. Preserve verified environment settings. Keep delivery disabled and job 32
   inactive. Do not call `/api/privacy/process` as a smoke test: it can process
   accepted destructive operations.
4. The maintenance setup script is a separate approval item. If later approved,
   deploy the handler first, install the initially inactive job, inspect its
   metadata, then seek separate activation approval. Do not execute it now.
5. Existing deletion/export device acceptance predates this separation. After
   deployment, the owner can run a fresh test-account export to verify attachment,
   authenticated download and retry behavior. Do not perform real deletion or send
   email on the owner's behalf.

The registration readiness failure remains a device investigation, not a
confirmed server fix. Background billing consent implementation, live dashboard
acceptance and the 50% offer remain separate. PostHog bulk capability and its
adapter must be completed before the remote-export proposal is reintegrated.
