-- Separate operator setup. Requires existing pg_cron, pg_net and Vault.
-- Transaction ensures this job is never installed active.
begin;
create or replace function public.invoke_moderation_worker() returns bigint
language plpgsql security definer set search_path=pg_catalog as $$
declare worker_url text; worker_secret text; request_id bigint;
begin
 select decrypted_secret into strict worker_url from vault.decrypted_secrets where name='moderation_worker_url';
 select decrypted_secret into strict worker_secret from vault.decrypted_secrets where name='moderation_worker_secret';
 if worker_url is distinct from 'https://www.dadhealth.co.uk/api/community/moderation/process' or nullif(btrim(worker_secret),'') is null
 then raise exception 'Moderation worker configuration invalid'; end if;
 select net.http_post(url:=worker_url,headers:=jsonb_build_object('Authorization','Bearer '||worker_secret,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=65000) into request_id;
 return request_id;
end $$;
revoke all on function public.invoke_moderation_worker() from public,anon,authenticated,service_role;
select cron.schedule('community-moderation-delivery','* * * * *','select public.invoke_moderation_worker();');
select cron.alter_job(jobid,active:=false) from cron.job where jobname='community-moderation-delivery';
commit;
