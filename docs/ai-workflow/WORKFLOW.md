# Dad Health AI engineering workflow

Use this process in both repositories; keep evidence and task records local to each.
Read root AGENTS.md, the existing Claude instructions and [ENGINEERING_MEMORY.md](ENGINEERING_MEMORY.md) before starting. Memory is required reading again before every step of the seven-step workflow.

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

## Scope and safety

- Never invent verified facts. Label evidence VERIFIED, INFERENCE or UNKNOWN; attribute user-reported results.
- Never silently expand scope or weaken tests to pass. A failing source assertion requires investigation, not automatic deletion.
- RLS, auth, subscriptions, migrations and production configuration require explicit approval covering those changes. General implementation approval is not blanket permission.
- No commits, pushes, builds or deployments without permission. Production operations require their own explicit authority.
- Preserve account isolation, private-data cleanup, canonical backend contracts, working functionality and unrelated edits. Never restore whole files to discard someone else's work.
- Follow existing migration safety rules: no rewriting applied migrations, no schema replacement shortcuts, no remote SQL without permission. Approved SQL work is validated locally first; unavailable local execution is NOT RUN.
- Keep credentials, tokens, personal records and sensitive payloads out of task records, diffs and logs.
- Do not reopen completed scoring or frozen product scope without explicit approval.

## Persistent records

Create `tasks/YYYY-MM-DD-short-task.md` from [TEMPLATE.md](tasks/TEMPLATE.md) when documentation writes are authorised. One active record per task per repository; no mandatory diary entries for each command.
For cross-repository work, use the same task ID and link the counterpart record. Each record owns its local plan/results; never claim the other repo passed without evidence.
Keep the original request and approval evidence, current phase, exact approved files, findings, check results, blockers and next action understandable without chat history.
Record approver, date when known and quoted approval or a durable reference; never infer approval. Record visual plan approval separately from approval to implement Codex's subsequent understanding. Transcribing a plan is not implementation authority.
Update at phase boundaries. Link architecture/product documents rather than copying them. Existing milestone trackers remain authoritative for milestone status; task records hold execution evidence, not a competing tracker.

## Verification selection

- Code changes: focused behavioural regressions, relevant repository TypeScript checks and `git diff --check`; run the full Node suite for shared changes and before final code review.
- Documentation-only changes: validate links/structure and `git diff --check`; application tests/typecheck may be recorded NOT RUN with the reason.
- SQL changes, only when approved: isolated local prerequisite/apply/reapply/regression checks; distinguish local from deployed evidence.
- UI/native/provider changes: mocks cover logic only; keep device, store/provider and deployed backend checks separate. Builds remain permission-gated.
- Use commands in [BASELINE.md](BASELINE.md). Read scripts before running them; do not install dependencies or substitute production when a check is unavailable.
- Compare failure names/messages, not totals alone. Refresh baseline observations when HEAD, working changes, runtime or dependencies change; retain prior observations. Baseline failures are unresolved defects or test issues, not permanent exemptions.

## Existing-instruction reconciliation

The mobile Claude scope-control rule requires inspection, a plan and approval before editing. These gates preserve it and add explicit findings review and understanding approval. Once implementation is explicitly authorised at step 4, routine in-scope steps need no repeated approval.
The backend Claude rules protect shared infrastructure and require approval before changes. This process adds explicit product/plan/review gates without relaxing those protections.
Older milestone status notes can conflict with later approved decisions (for example mobile Sunday 08:00 wording versus the later Sunday 18:00 Europe/London approval). Neither workflow setup nor stale text authorises product changes. Cite the later approval; report unresolved conflicts before changing behaviour. Existing Claude files remain unchanged.

## Engineering memory self-correction

Before each task/phase gate, identify relevant incidents and rules, inspect the actual checkout and state what must remain unchanged. Record the review in the task template when record writes are authorised; otherwise use chat.
After each meaningful implementation change, check all five memory patterns against the diff and observed results. If a regression, rejected approach or failed assumption appears, pause dependent edits, investigate and distinguish the hypothesis from verified cause. Do not stack speculative fixes.
Before review, inspect the full diff including new files, match every changed file to approved scope, verify preserved behaviour and compare actual tests with the baseline. Report remaining risks and automated/device/production evidence separately.
Add only genuinely new evidence-backed lessons using the memory incident format. Do not log routine edits or every passing test. Memory changes require explicit inclusion of each memory file in the approved plan; REVIEW-ONLY/PLAN-ONLY lessons remain proposals in chat or an authorised task record unless a separate memory update is authorised. Never silently rewrite incidents or mirror edits into an unapproved repository.
