# Item 05 Phase 2: operations and review

Local implementation only. No production migration, email, publisher grant or prompt import was performed. Jamie confirmed hello@dadhealth.co.uk is monitored. Database installation and provider/device acceptance remain separate.

## Deployment order (operator review required)

1. Preserve installed Phase 1 privacy migrations and existing community/circle/anonymous-owner functions. Review the current live definitions against the compatibility checks below; repository files do not establish live installation.
2. Apply `supabase/migrations/20261119120000_community_report_block.sql` once. It adds reports, blocks, private delivery/retention tables, scoped RPCs, restrictive visibility policies and a private wrapper around the existing export capture function. It does not rewrite captured exports or delete existing content.
3. Apply `supabase/migrations/20261119130000_community_official_prompts.sql` once. It adds private publisher grants, contribution stamps and private discussion-post seed receipts/import RPCs and the approved seed-only hourly-index exception. Existing content is not retroactively branded. No publisher is granted and no prompt is imported by this migration.
4. Deploy backend/mobile together after review. Configure server-only `MODERATION_WORKER_SECRET` (strong independently generated value), `MODERATION_DELIVERY_ENABLED=true` when approved, and existing `RESEND_API_KEY`. Existing sender is `Dad Health <noreply@send.dadhealth.co.uk>`; confirm its verified domain. Never expose these in EXPO_PUBLIC/NEXT_PUBLIC variables or Git.
5. In Supabase Vault's secure operator interface create `moderation_worker_url` = `https://www.dadhealth.co.uk/api/community/moderation/process` and `moderation_worker_secret` equal to the server secret. Do not print decrypted Vault values. Confirm this is the canonical deployed host; if a different host is required, review the wrapper allowlist before activation.
6. Install `supabase/moderation-worker-scheduler.sql`. Requires existing pg_cron, pg_net and Vault. Transaction installs the separate minute job INACTIVE. It calls a POST-only endpoint using Bearer authentication; ordinary GET cron is insufficient. No manual invocation is needed.
7. After review and controlled acceptance, activate with `select cron.alter_job(jobid,active:=true) from cron.job where jobname='community-moderation-delivery';`. Pause using the same statement with `false`. These are instructions only; not executed in production. Activation permits email delivery AND destructive resolved-report retention cleanup.

## Read-only configuration and compatibility checks

Run in the operator SQL interface without displaying secrets or private report content:

```sql
select name, count(*) from vault.secrets
where name in ('moderation_worker_url','moderation_worker_secret') group by name;
select jobid,jobname,schedule,active from cron.job
where jobname='community-moderation-delivery';
select status,count(*) from cron.job_run_details
where jobid in (select jobid from cron.job where jobname='community-moderation-delivery')
group by status;
select state,count(*),max(attempts) from public.community_report_delivery group by state;
select days_after_resolution from public.community_report_retention;
select count(*) filter(where resolved_at is null) unresolved,
       count(*) filter(where retention_hold_reason is not null) held,
       count(*) filter(where resolved_at < now()-interval '90 days' and retention_hold_reason is null) eligible
from public.community_reports;
select tablename,policyname,permissive,roles,cmd from pg_policies
where schemaname='public' and tablename in ('posts','comments','community_reports','community_blocks','community_publishers');
select has_function_privilege('authenticated','public.claim_community_report_delivery()','execute') client_worker,
       has_function_privilege('authenticated','public.hold_community_report(uuid,text)','execute') client_hold,
       has_function_privilege('authenticated','public.import_community_prompts(jsonb,uuid)','execute') client_import;
```

All three privilege checks must be false. Also review installed `can_read_community_post`, `can_read_community_comment`, `get_community_author_avatars`, `guard_account_privacy_write`, `account_export_dataset` and their dependencies/owners. The migration composes restrictive policies with existing circle policies; it must not replace live policies with permissive alternatives. Phase 1 guards must already exist. Inspect pg_net response HTTP status (not bodies/headers) and deployed worker logs separately: a completed cron SQL call only means HTTP was enqueued.

## Resolution, holds and delivery monitoring

No admin panel or client moderation powers added. Authorised operators use service-role RPCs `resolve_community_report(p_id)`, `hold_community_report(p_id,p_reason)` and the normal scheduled worker. Resolution is set once. A hold requires a nonblank reason (maximum 1,000 characters); release passes null and does NOT alter resolved_at. A report already older than 90 days becomes eligible at the next cleanup immediately after release. Restrict operator access and review ongoing holds regularly. Unresolved reports are not automatically purged by this rule; no invented response-time promise.

Worker processes up to three deliveries per invocation; claim leases last two minutes and overlap uses SKIP LOCKED. Provider requests have a 15-second bound. Failures remain queued for five-minute retry. The private excerpt (up to 500 Unicode characters), reason and explanation are captured once and protected against updates; source edits/deletion cannot change retries. Immutable report data and `community-report-v1-<id>` preserve the provider idempotency payload. An ambiguous attempt exceeding 23 hours becomes `needs_review` rather than risking duplication after the provider's idempotency window. Operators must inspect provider evidence before recovery; do not blindly requeue an ambiguous send with a new key. HTTP failures and safe `ModerationDelivery` reasons are logged without identities or bodies. Monitor queued age, needs_review, HTTP failures and provider bounces. `accepted` means Resend accepted a message, NOT that Jamie received/read it. There is no new bounce webhook or automatic mailbox deletion.

## Privacy-policy wording for Jamie

> When you report community content, we store your report and a short copy of the reported content (up to 500 characters) so we can review it. That copy remains part of the report if the original content is edited or removed; it is not treated as anonymous. We normally remove resolved reports from our application database 90 days after resolution. If an ongoing issue requires us to keep a report longer, an authorised person records a retention hold and its reason. Removing the hold does not restart the 90-day period: retention is measured from the original resolution date. Copies sent to our monitored reports email inbox are stored separately. Deleting a report from the application database does not delete those email copies.

Mailbox-specific deletion/hold practices and the email provider's retention must be confirmed separately before adding a time promise about emailed copies. The implementation does not control Jamie's mailbox. Existing Phase 1 account deletion removes reporter-owned database reports and their delivery metadata, including held rows, via Auth cascades; this remains the approved complete-deletion exception. Reports made by others retain their target reference, explanation and the bounded excerpt under the report retention rule, even after the reported source content or its author is removed. This is explicit retained moderation evidence, not anonymised text. Excerpts are never added to owner account exports. Reporter account deletion still cascades that reporter's reports and delivery rows, including holds. Email copies remain separate. Existing backups/provider retention are not changed.

## Official author and prompt rollout

Production publishing identity is UNRESOLVED. The earlier Gmail candidate was withdrawn; do not use it. Communication preferences for hello@ or Jamie@ are not Auth identity evidence. No grants/imports have been made. Local tests use verified synthetic publishers only.

After Jamie confirms the exact UUID and explicit production approval, use an operator-only SQL session. Supply `publisher_uuid` as a psql variable with that confirmed value (there is intentionally no default):

```sql
begin;
select set_config('dadhealth.operator_publisher', :'publisher_uuid', true);
do $$ declare candidate uuid:=current_setting('dadhealth.operator_publisher')::uuid; begin
 perform pg_advisory_xact_lock_shared(hashtextextended('account-privacy:'||candidate::text,0));
 if not exists(select 1 from auth.users where id=candidate and email_confirmed_at is not null)
 or exists(select 1 from public.account_deletion_tombstones where user_id=candidate)
 then raise exception 'Publisher identity must be reverified'; end if;
 insert into public.community_publishers(user_id) values(candidate) on conflict(user_id) do nothing;
end $$;
commit;
```

This grants only official presentation, not moderation powers. The existing composer remains unchanged. New eligible nonanonymous contributions are stamped Dad Health/Official. Normal updates preserve the original stamp; a later publisher grant cannot brand historical posts/comments. Anonymous content/deletion placeholders cannot carry official identity. Revocation prevents new official contributions without rewriting historical attribution.

`supabase/seeds/jamie-circle-prompts-20261119.json` preserves all 24 supplied strings and stable keys, and pins the user-confirmed existing circle IDs:

| Circle | Expected existing UUID |
|---|---|
| Dad Strength | bf6bb92e-b4a4-46e9-bb03-945c799ee180 |
| Every Kind of Dad | ea936e66-fe3d-470c-a31f-659ea410f34d |
| New Dad Crew | 017f31fa-aa8c-4450-aa8d-51b4cbf86754 |
| Single Dads | fe154973-295e-412b-ae60-a92c8baf1724 |

Evidence was supplied by the user, not queried in this run. With an approved server environment loaded, preview:

```powershell
node scripts/community-prompts.mjs --publisher=$env:CONFIRMED_PUBLISHER_UUID
```

The UUID variable must be explicitly supplied; missing/malformed identity is rejected before network access. Preview validates current verified publisher permission and circle name/UUID mappings, and shows publisher UUID, circle UUID, exact content and action (create/existing/removed). It writes nothing. Review all 24 mappings before the separately authorised import:

```powershell
node scripts/community-prompts.mjs --publisher=$env:CONFIRMED_PUBLISHER_UUID --apply
```

The service credential stays in the existing server environment and is never printed. Import creates ordinary named discussion posts in `posts`, with existing feeds/replies and official presentation. It does NOT alter `circle_prompts`. A private `community_prompt_seeds` receipt records stable key, publisher/circle/post reference and content digest. Concurrent imports lock together. Exact reimport creates nothing; changed content, author or mapping requires review. Deleted seeded posts are not resurrected. Account deletion removes publisher/post references; receipt keys/digests contain no raw report/Journal content.

The approved hourly exception applies ONLY when a matching private import receipt exists. Clients cannot write receipts or forge/copy the `seeded_prompt` flag. Updates preserve the original flag; ordinary posts cannot become exempt. The existing unique `(user_id, UTC hour)` index is recreated with `where not seeded_prompt`; all manual posts, including Jamie's, retain the limit. The migration refuses to replace an unexpected installed index definition. Inspect locks/maintenance timing before applying this transactional index change.

### Read-only checks BEFORE applying either pending migration

```sql
select to_regclass('public.community_reports') reports_table,
       to_regclass('public.community_publishers') publishers_table,
       to_regprocedure('public.import_community_prompts(jsonb,uuid)') revised_import;
select version from supabase_migrations.schema_migrations
where version in ('20261119120000','20261119130000');
select pg_get_indexdef(to_regclass('public.limit_posts_per_hour'));
select name,id from public.circles
where lower(btrim(name)) in ('dad strength','every kind of dad','new dad crew','single dads') order by name,id;
select p.oid::regprocedure, r.rolname as owner, p.prosecdef, p.proconfig, p.proacl,
       pg_get_functiondef(p.oid)
from pg_proc p join pg_roles r on r.oid=p.proowner
where p.pronamespace='public'::regnamespace and p.proname in
 ('can_read_community_post','can_read_community_comment','get_community_author_avatars',
  'account_export_dataset','guard_account_privacy_write','cleanup_account_private_records');
select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('posts','comments','anonymous_post_owners','user_circles');
select tgrelid::regclass,tgname,pg_get_triggerdef(oid) from pg_trigger
where not tgisinternal and tgrelid in ('public.posts'::regclass,'public.comments'::regclass);
```

If either pending migration (or its objects from a manual SQL application) is already installed in a shared database, STOP: do not apply the revised file over it; prepare a forward correction. Expected original hourly index is the unconditional unique index shown in `supabase/schema.sql`. Confirm Phase 1 privacy guards/cascades and circle membership helpers match the reviewed contracts. These queries reveal definitions/IDs only, not private post content or secrets. Run identity verification only after the new candidate is explicitly confirmed; no withdrawn UUID is embedded in these commands.

## Device/provider acceptance still required

- Logged out: open Mind urgent help; check all services, large text and inline launch failure without contacting services as a test. Check native SMS composer cancellation only with an approved safe test destination.
- Accounts A/B/C: report normal and anonymous posts/comments from feed, circles, trending and nested threads; persistence receipt, rapid taps, lost response, and safe validation feedback.
- A blocks B: B's normal/anonymous posts/comments disappear across pages, saved links and direct threads; C is unaffected; other authors' replies remain. Reopen offline then reconnect; switch accounts while a response is pending. Unblock in Settings restores server-visible content.
- With local fixture publisher only, verify Dad Health/Official across feed, circle and thread/comment surfaces; unprivileged names must not earn a badge.
- Verify approved production worker configuration separately, then one explicitly authorised test report: distinguish provider acceptance from actual monitored-inbox receipt. No such email was sent in this implementation.
- Regression: Phase 1 deletion placeholders and export remain usable; latest immutable export contains only safe owner-attributable report/block records, not another reporter or anonymous author's identity.
