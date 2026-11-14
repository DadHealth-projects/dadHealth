# Dad Health engineering memory

Persistent engineering constraints, not product requirements or permission to edit.
Read before every task and before every step of the seven-step workflow.
Global rules are identical in both repositories. Evidence paths below are relative
to the shared workspace (dadhealth-mobile/ or dadHealth/), not this directory.

## Five recurring failure patterns

1. **SYMPTOM PATCHING**: Trace the underlying data flow, state lifecycle and root
   cause before proposing a fix. Separate hypotheses from verified causes. A
   presentation-only change cannot establish that the data problem is solved.
2. **UNREQUESTED CHANGES**: Preserve approved behaviour and UI. Edit only files
   and behaviour covered by the approved plan. Stop and request approval if
   additional scope is necessary; do not bundle unrelated redesign or cleanup.
3. **DEFENSIVE CODE REGRESSIONS**: Do not introduce speculative retries, timeouts,
   refreshes, fallbacks, loading states, banners or overlays. Establish the
   failing path, justify the smallest correction and define evidence that proves
   improvement without breaking existing behaviour. A timeout alone does not
   prove underlying work stopped; a fallback must not disguise failed reads.
4. **PREMATURE SUCCESS CLAIMS**: Compilation, source inspection, unit tests and
   HTTP 200 each prove only their own layer. Report automated, device and
   production verification separately. Never claim a feature works end to end
   without evidence for its acceptance criteria; attribute user-reported checks.
5. **REPEATED FAILED APPROACHES**: A failed fix is counterevidence. Stop stacking
   patches; revisit the hypothesis, inspect the failed attempt and choose a
   different evidence-backed approach. If the cause remains unknown, escalate
   with the smallest missing diagnostic, not another speculative implementation.

## Seven-step workflow and separate approvals

1. **INVESTIGATE**: Codex investigates read-only and reports evidence, hypotheses and unknowns. No implementation.
2. **FINDINGS REVIEW**: Humans review the findings. Codex waits for their direction before advancing.
3. **VISUAL PLAN APPROVAL**: The user and planning partner prepare and approve the plan visually, including behaviour, exact files and tests. Codex may supply requested evidence or options; its own proposed plan is not approval.
4. **UNDERSTANDING**: Codex explains its understanding of the human-approved plan, scope, preserved behaviour and checks. No implementation. Stop for explicit human approval to implement that understanding.
5. **IMPLEMENT AND TEST**: Only after step 4 approval, Codex implements and tests within the approved scope. Routine in-scope steps need no repeated permission; new scope requires approval.
6. **DIFF REVIEW**: Humans inspect the complete diff, including new files and results, against the approved plan. Codex waits; passing tests are not approval.
7. **ACCEPT OR CORRECT**: Humans accept or request corrections before moving forward. Scope-changing corrections return to plan and understanding approval; explicitly authorised in-scope corrections are retested and returned to diff review. Never auto-accept.

Keep separate evidence for findings review, visual plan approval, approval of Codex's understanding to implement, diff review and acceptance. Codex's own plan or understanding NEVER grants permission to implement; plan approval alone does not skip step 4. Existing explicit approval for the same gate/scope remains valid; never infer a missing gate from silence or an earlier phase.
Requirements and product decisions are recorded before planning. Relevant device/backend acceptance evidence is required before final acceptance (or an explicit human waiver is recorded); mocked tests do not replace it. Commit, push, build, deployment and production actions retain their separate permission requirements.

## Self-correction loop and authority

- Before each task: read this memory, identify relevant incident IDs/rules,
  inspect the actual checkout/status and state the behaviour to preserve.
  Read it again at every seven-step workflow transition; cached
  understanding does not replace checking for updates.
- During implementation: after each meaningful change, compare the diff and
  observed results with all five rules and approved scope. On a regression,
  rejected approach or failed assumption, pause dependent edits, separate facts
  from hypotheses and investigate. No broad rollback or whole-file restoration.
- After implementation: review the complete diff including new files; match
  every changed file to the approved plan; verify preserved behaviour; compare
  failure names/messages with BASELINE.md; report risks and verification gaps.
- Record genuinely new mistakes/useful lessons only, not passing tests or every
  routine edit. Use the format below; keep incidents brief and source-backed.
- Memory never grants edit authority. REVIEW-ONLY or PLAN-ONLY lessons stay in
  chat or an explicitly authorised task report; no global memory edits unless
  separately authorised. During implementation, each memory file must itself
  be explicitly in the approved file scope. Do not silently sync the other repo.
- Never silently rewrite history. Append dated evidence/corrections to the same
  incident ID, preserving the original observation and noting supersession.
  Distinguish incident date from recording date; unknown dates remain unknown.
  If global rules need changing, request approval for both copies and report drift.
- Evidence labels: VERIFIED SOURCE/TEST, USER-REPORTED, INFERENCE, UNKNOWN.
  Verified source is not verified historical causation or deployed behaviour.
  No secrets, user identities, private content or raw provider payloads in memory.
- These are agent instructions, not an installed runtime monitor or automated
  enforcement service. Detect mistakes through evidence, scoped diffs, relevant
  regressions and human/device feedback; do not claim guaranteed prevention.

## Incident format

- Date and task ID (original date/ID if known; otherwise unknown; recording date)
- Pattern category
- What went wrong
- Evidence and affected files
- Root cause: verified or unknown
- Correction or rejected approach
- Prevention rule
- Verification result
- Status

## Seed history - recorded 2026-11-12

Historical chat reports below were supplied in this conversation. No unavailable
logs, commits or original fix diffs are inferred. Source observations refer to
mobile HEAD c38161a1c169c85e2ce72cc459758a2f9e738ea1 and backend HEAD
5af0c0abcf56e8fee78b12643d055a416f2f5eba; recheck paths/lines after checkout changes.

### EM-001 - Dashboard loading and slow logout

- Date/task: original date and formal task ID unknown; startup/loading investigation; recorded 2026-11-12.
- Pattern: SYMPTOM PATCHING; DEFENSIVE CODE REGRESSIONS; PREMATURE SUCCESS CLAIMS.
- What went wrong: USER-REPORTED splash/skeleton hangs and slow logout in Expo Go and TestFlight. Reported trace: auth hydration 3ms, dashboard cache about 100ms, onboarding profile 67s, dashboard fetch repeatedly 12s.
- Evidence/files: chat request beginning "Use this device trace as evidence"; dadhealth-mobile/hooks/useDashboard.ts:239 withTimeout, :765-793 load effect; screens/DashboardScreen.tsx:186 skeleton predicate; contexts/AuthContext.tsx onboarding lookup.
- Root cause: UNKNOWN for the 67s delay, logout slowdown and device-wide hang. Current effect depends on connectivity/user, not every render; a null-data branch alone does not prove the historical retry loop.
- Correction/rejected approach: user rejected more timeout/cache/provider rewrites and forced loading=false. Requested a settled error state, request cancellation where supported and fixed-label timings separating headers/body parsing.
- Prevention: trace the exact restart caller and request phase; distinguish no-data loading/error/offline; preserve loaded content and account cleanup.
- Verification: trace is USER-REPORTED, not reproduced here. Current source uses !data && loading && !dashboardError; this is not proof the device slowdown is fixed. No device checks in memory setup.
- Status: historical outcome unverified; no automatic remediation authorised.

### EM-002 - Today/Body Workout Library inconsistency

- Date/task: original date/ID unknown; Workout Library investigation; recorded 2026-11-12.
- Pattern: SYMPTOM PATCHING; DEFENSIVE CODE REGRESSIONS.
- What went wrong: USER-REPORTED workouts disappearing during refresh and a Pro account seeing "No workouts are available yet" after Today -> Explore Workouts. Requested preservation of navigation, layout and Free restrictions.
- Evidence/files: chat "CODEX TASK - Fix empty Workout Library for Pro users" and later scoped approval; dadhealth-mobile/hooks/useFitnessLibrary.ts:135-181 retains same-owner content and separates assignment errors; screens/FitnessScreen.tsx:94,110-128 separates fetched/visible counts and access; screens/DashboardScreen.tsx:610-618 opens Fit modal.
- Root cause: UNKNOWN for the actual account's empty library. VERIFIED SOURCE shows entitlement-based filtering and current retention guards; no live entitlement/query result was inspected. Do not conclude database empty or RLS broken.
- Correction/rejected approach: approved narrow hook/screen tests and count diagnostics; rejected weakening access or making all workouts Free. Current source guards are not evidence of a successful device fix.
- Prevention: trace owner -> access -> fetch -> weekly assignment -> visible filtering across both screens; distinguish unknown, failed and genuine empty results; preserve valid data on refresh.
- Verification: current source inspected; real-account cause and real-device resolution remain unverified. No production query or device test performed here.
- Status: supported report, resolution unknown; preserve working Today modal navigation.

### EM-003 - Unintended Community presentation changes

- Date/task: original date/ID unknown; Community UI concern named in this memory request; recorded 2026-11-12.
- Pattern: UNREQUESTED CHANGES; PREMATURE SUCCESS CLAIMS.
- What went wrong: USER-REPORTED category of unintended Community UI changes. Available history does not identify a specific offending patch, author or approved before/after design.
- Evidence/files: current user explicitly requests this incident; baseline audit reports failing assertions in dadhealth-mobile/tests/dashboardSectionLayout.test.mjs:68 (compact circle tiles) and tests/change08BondCommunity.test.mjs:73 (description/subtitle), referencing screens/CommunityScreen.tsx. Assertion mismatches do not prove an unauthorised redesign.
- Root cause: UNKNOWN; cannot distinguish stale tests from product regression using these facts alone.
- Correction/rejected approach: no corrective Community edit verified here. Do not change UI to satisfy an old source-string assertion or invent a historical revert.
- Prevention: compare requested scope and approved visual reference against the complete diff before changing Community; require explicit approval for unrelated design changes.
- Verification: prior baseline failures recorded, not rerun here; no visual/device evidence available.
- Status: provisional user-reported incident; dated before/after evidence needed before asserting causation or resolution.

### EM-004 - Notification HTTP success without delivery

- Date/task: original date/ID unknown; community_reply notification investigation; recorded 2026-11-12.
- Pattern: PREMATURE SUCCESS CLAIMS; SYMPTOM PATCHING.
- What went wrong: USER-REPORTED saved comment, no push and response {"ok":true,"sent":0,"skipped":1}. Later supplied production results said master push enabled, community_reply row missing, no duplicate claim and daily limit not reached.
- Evidence/files: chat "Investigate the root cause of missing notification preference rows"; dadHealth/src/app/api/notifications/events/route.ts:31-52 sendIfAllowed requires both flags true, :324 returns ok with result counters; src/lib/notifications/delivery.ts:17-60 handles claim, provider request and completion.
- Root cause: VERIFIED SOURCE: a missing preference row takes the disabled/skip branch. Production association is USER-REPORTED, not independently queried here. Why the row was missing remains UNKNOWN.
- Correction/rejected approach: trace defaults/initialisation/persistence; do not assume missing preferences mean consent or blame recipient targeting merely because no push arrived. No preference repair/deployment established here.
- Prevention: distinguish event accepted, eligible recipient, claim acquired, provider accepted and device received. Read counters, not HTTP status alone; provider message ID is not proof of device receipt.
- Verification: branch inspected; production records and device delivery not checked in this task.
- Status: skip mechanism supported; preference root cause/resolution and delivery acceptance unverified.

### EM-005 - Repeated unsuccessful loading patches

- Date/task: original date/ID unknown; repeated startup fixes, related to EM-001 (not a separate reproduced outage); recorded 2026-11-12.
- Pattern: REPEATED FAILED APPROACHES; DEFENSIVE CODE REGRESSIONS; UNREQUESTED CHANGES.
- What went wrong: user stated "Previous loading patches did NOT resolve it" and rejected added retry/skeleton UI. The history names requestDeadline.ts, global fetch deadlines, SecureStore caching, provider relocation, offline-worker cancellation and cache-write changes as patches to review, not proven causes.
- Evidence/files: chat "Find and fix the actual cause of the app hanging" and later narrow approval to correct "16 abortSignal typing errors introduced by the earlier patch"; implicated dadhealth-mobile/lib/offlineSync.ts, lib/secureStore.ts, hooks/useDashboard.ts and contexts/AuthContext.tsx. Historical versions and exact error log are unavailable here.
- Root cause: UNKNOWN for persistent slowdown; attribution of 16 typing errors to the patch is USER-REPORTED. Do not infer each named patch caused a regression.
- Correction/rejected approach: stop speculative stacking; inspect builder-stage cancellation typing and request lifecycle, preserving cancellation/account cleanup. No historical correction or successful device outcome independently verified here.
- Prevention: failed acceptance invalidates the success claim; retain failed hypothesis, obtain discriminating evidence, then propose one justified change. Escalate unknown causes with a precise reproduction/diagnostic request.
- Verification: prior baseline later reports mobile TypeScript passing, but that does not establish when/type-error correction occurred or resolve device performance. No new runtime tests in this workflow task.
- Status: recurring user-reported failure pattern; no claim of confirmed performance repair.

## Approved refresh presentation rule - 2026-11-13

Never replace known workout content or a confirmed empty assignment with "Checking this week's workout" or new loading text during refresh. Keep prior content on recoverable failure. Show no-assignment copy only after a successful assignment read confirms absence; unknown/error is not empty. Apply this rule to equivalent refresh UI without expanding the approved task scope. User-approved rule; device verification remains separate.
