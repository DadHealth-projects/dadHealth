# Dad Health agent instructions

Website and shared backend; mobile client lives in ../dadhealth-mobile.

Read [Claude.md](Claude.md) first; preserve its product decisions, safety rules and protected shared contracts. Read applicable nested instructions before editing.
Use [WORKFLOW.md](docs/ai-workflow/WORKFLOW.md), [BASELINE.md](docs/ai-workflow/BASELINE.md) and the relevant local [task record](docs/ai-workflow/tasks/TEMPLATE.md).
Inspect Git status before work; preserve existing changes. Current explicit user instructions govern the task; report conflicts rather than silently replacing existing safety rules.

Implementation requires a task record with human-reviewed findings, human-approved visual/file plan, Codex's subsequent understanding, and separate explicit human approval to implement that understanding. Codex's own plan or understanding is never permission to implement. Review-only requests permit no file edits, including task records.
After the step 4 understanding/implementation approval, complete in-scope implementation and verification autonomously; stop at new scope/product decisions and the step 6 DIFF REVIEW gate. Never treat approval as authority for unrelated sensitive changes or production actions.
Do not modify RLS, auth, subscriptions, migrations or production configuration without explicit approval. No commits, pushes, builds or deployments without permission.
Preserve account isolation and working functionality. Never weaken tests or invent verified facts. Separate source/mock evidence from device/deployed evidence.
Keep records concise and local; link architecture documents instead of copying them. Do not automatically mark tasks complete.

## Engineering memory gate

Read [ENGINEERING_MEMORY.md](docs/ai-workflow/ENGINEERING_MEMORY.md) before every task and before every step of the seven-step workflow. Identify relevant incident IDs and state the existing behaviour to preserve; inspect the actual checkout, not remembered code.
Follow its before/during/after self-correction loop. Stop speculative patch stacking when evidence contradicts the hypothesis. Memory records never override scope or approval gates.
Global memory edits require explicit file-scope approval for each repository. In REVIEW-ONLY or PLAN-ONLY work, report proposed lessons in chat or an authorised task report; do not edit memory unless separately authorised. Preserve historical entries and append dated corrections rather than silently rewriting them.
