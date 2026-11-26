-- PRODUCTION ROLLBACK NOT YET MATERIALIZED: live pre-change snapshot is pending.
-- This file intentionally cannot restore guessed definitions or permissions.
-- 1. Save the security-only preflight JSON result privately as security-before.json.
-- 2. Review it against the current production definitions and migration.
-- 3. Generate a NEW file using:
-- node scripts/security-migration-rollback.mjs <security-before.json> <rollback-reviewed.sql>
-- 4. Review generated definitions/grants: old grants may reintroduce vulnerabilities.
-- Prefer a narrow forward repair over restoring unsafe PUBLIC/anon permissions.
-- 5. Only after explicit approval, use the generated file with the session-only
-- setting dadhealth.security_rollback_approved=yes. Do not alter database settings.
do $$begin
  raise exception 'Not executable: exact production rollback snapshot has not been supplied and approved';
end $$;
