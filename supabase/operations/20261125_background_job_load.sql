-- Background job load reduction (live evidence 2026-11-25, read-only MCP). NOT a migration:
-- run by hand in the SQL editor ONLY after the client approves the latency change below.
--
-- Evidence (pg_stat_statements since 2026-11-17, ~8 days):
--   * pg_cron bookkeeping (cron.job_run_details insert/update) = 45% of all database time;
--     a one-row insert averaged 352 ms (writes waiting on a throttled disk).
--   * Jobs 30 (account-privacy-worker) and 31 (community-moderation-delivery) run every
--     minute: ~2,880 of the ~3,000 daily cron runs. Each run also writes pg_net queue and
--     response rows and makes the Vercel worker call two RPCs.
--   * The database is 30 MB and fits in memory; disk reads are negligible. The load is
--     write and commit churn from schedules, not app traffic (live scores = 5%).
--
-- Change: run both workers every 5 minutes instead of every minute (-80% runs), and keep
-- 7 days of cron run history. Not disabled: privacy requests and moderation reports are
-- still processed, at most ~5 minutes later than today.
--
-- Pre-check (read-only):
--   select jobid, jobname, schedule, active from cron.job where jobid in (30, 31);
--   -- expect: 30 account-privacy-worker '* * * * *'; 31 community-moderation-delivery '* * * * *'
--
-- Rollback:
--   select cron.alter_job(30, schedule => '* * * * *');
--   select cron.alter_job(31, schedule => '* * * * *');
--   select cron.unschedule('cron-run-history-retention');

select cron.alter_job(30, schedule => '*/5 * * * *');
select cron.alter_job(31, schedule => '*/5 * * * *');

-- Daily at 04:17 UTC, delete cron run history older than 7 days (bounded batch).
select cron.schedule(
  'cron-run-history-retention',
  '17 4 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);

-- Post-check (read-only), after 24 hours:
--   select jobname, schedule from cron.job where jobid in (30, 31);
--   select count(*) from cron.job_run_details where start_time > now() - interval '1 day';  -- expect ~600, was ~3,000
--   select calls, round(mean_exec_time) from extensions.pg_stat_statements
--    where query like 'insert into cron.job_run_details%';                               -- mean should fall
