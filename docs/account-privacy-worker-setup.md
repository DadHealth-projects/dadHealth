# Privacy worker scheduling

The privacy worker is POST-only and independent of the mobile app. Reuse the
existing Supabase Cron/pg_net/Vault infrastructure, with a separate job and secret
from notification dispatch. Do not add a Vercel GET cron.

## Setup (operator actions, not performed by Codex)

1. Verify the three Item 05 privacy migrations are installed. Verify pg_cron,
   pg_net and Vault are available. Do not run the combined schema.
2. Generate a strong random secret in a password manager. Set it as the Vercel
   Production environment variable `PRIVACY_WORKER_SECRET`. Deploy the worker
   route with `maxDuration = 60`; verify the hosting plan supports that duration.
   Keep the five-minute database lease longer than the function lifetime.
3. In Supabase Vault's secure UI create `privacy_worker_secret` with the SAME
   value, and `privacy_worker_url` with
   `https://www.dadhealth.co.uk/api/privacy/process`. Never paste the secret into
   committed SQL, screenshots, terminal output or cron.command.
4. Review and apply `supabase/privacy-worker-scheduler.sql` as postgres. It
   installs an **inactive** once-per-minute job. Reapplying disables the job.
   It does not invoke the endpoint. The wrapper fails closed for absent,
   duplicate or unexpected URL configuration.
5. Confirm all existing cleanup/provider/retention configuration is ready and
   the approved `PRIVACY_OPERATIONS_ENABLED` setting is correct. Do not bypass
   cleanup requirements to drain queued work.
6. Only after approval to process accepted operations, activate:

```sql
select cron.alter_job(jobid, active := true)
from cron.job where jobname = 'account-privacy-worker';
```

Activation is destructive-operation authority. Do NOT invoke the wrapper
manually as a connectivity test. To pause future dispatch, use `active := false`;
that does not cancel requests already accepted by the worker.

## Read-only verification

```sql
select jobid, jobname, schedule, active from cron.job
where jobname = 'account-privacy-worker';
select name, count(*) from vault.secrets
where name in ('privacy_worker_url', 'privacy_worker_secret') group by name;
select jobid, status, start_time, end_time from cron.job_run_details
where jobid in (select jobid from cron.job where jobname = 'account-privacy-worker')
order by start_time desc limit 10;
select id, status_code, timed_out, created from net._http_response
order by created desc limit 20;
select state, attempts, account_removed_at, completed_at, next_attempt_at,
       lease_until, failure_code
from public.account_privacy_operations
where id = '0bbfa65e-4083-4485-85d0-a1cf7ef1e2c6';
```

Never select decrypted secrets, request headers or response bodies for sharing.
Cron success means HTTP was enqueued; HTTP 200 means worker invocation returned.
Neither means deletion completed. Check the operation's state: `completed`
requires required cleanup completion, separate from `account_removed_at`.
401 means worker secret/auth mismatch; 503 can indicate rollout/configuration or
worker failure. Use the response correlation ID in Vercel runtime logs.

Overlapping requests use the existing transactional `FOR UPDATE SKIP LOCKED`
claim and five-minute lease. Later invocations recover expired leases; retries
retain the original operation. Do not recreate a queued deletion. Each call
claims at most two operations. Monitor backlog/failures before changing cadence.
