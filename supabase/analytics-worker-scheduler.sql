-- Operator-reviewed setup only. NOT an automatically applied migration.
-- Installs an inactive POST job; contains no credentials.
begin;
create or replace function public.invoke_analytics_worker()
returns bigint language plpgsql security definer set search_path=pg_catalog as $$
declare endpoint text; secret text; request_id bigint;
begin
 select decrypted_secret into strict endpoint from vault.decrypted_secrets where name='analytics_worker_url';
 select decrypted_secret into strict secret from vault.decrypted_secrets where name='analytics_worker_secret';
 if endpoint is distinct from 'https://www.dadhealth.co.uk/api/analytics/process' or nullif(btrim(secret),'') is null then
  raise exception 'Analytics worker configuration invalid';
 end if;
 select net.http_post(url:=endpoint,
  headers:=jsonb_build_object('Authorization','Bearer '||secret,'Content-Type','application/json'),
  body:='{}'::jsonb,timeout_milliseconds:=65000) into request_id;
 return request_id;
end $$;
revoke all on function public.invoke_analytics_worker() from public,anon,authenticated,service_role;
do $$
declare
  new_job_id bigint;
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'optional-analytics-worker'
  ) then
    new_job_id := cron.schedule(
      'optional-analytics-worker',
      '* * * * *',
      'select public.invoke_analytics_worker();'
    );

    perform cron.alter_job(new_job_id, active := false);
  end if;
end;
$$;

-- Existing jobs keep their current activation state.
-- A newly created job is disabled inside the DO block.
commit;
