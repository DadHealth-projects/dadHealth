-- Operator setup only; NOT an automatically applied migration.
-- Requires existing pg_cron, pg_net and Supabase Vault. No secrets in SQL.
-- This transaction installs an INACTIVE job. Activation processes accepted
-- destructive operations and requires separate operator approval.
begin;
create or replace function public.invoke_privacy_worker()
returns bigint language plpgsql security definer
set search_path = pg_catalog
as $$
declare worker_url text; worker_secret text; request_id bigint;
begin
  select decrypted_secret into strict worker_url from vault.decrypted_secrets
    where name = 'privacy_worker_url';
  select decrypted_secret into strict worker_secret from vault.decrypted_secrets
    where name = 'privacy_worker_secret';
  if worker_url is distinct from 'https://www.dadhealth.co.uk/api/privacy/process'
    or nullif(btrim(worker_secret), '') is null then
    raise exception 'Privacy worker configuration invalid';
  end if;
  select net.http_post(
    url := worker_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || worker_secret,
      'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 65000
  ) into request_id;
  -- Request ID is transport evidence, never operation completion.
  return request_id;
end;
$$;
revoke all on function public.invoke_privacy_worker() from public, anon, authenticated, service_role;
-- Run setup as postgres; only its Cron job can invoke this owner-only wrapper.
select cron.schedule('account-privacy-worker', '* * * * *',
  'select public.invoke_privacy_worker();');
select cron.alter_job(jobid, active := false)
  from cron.job where jobname = 'account-privacy-worker';
commit;
