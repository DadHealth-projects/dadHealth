-- Metadata only. No secrets, account rows, provider payloads or job commands.
-- Missing history alone does not prove objects are absent. No mutations.
select expected.name, c.oid is not null as installed,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
       case when c.oid is null then null else has_table_privilege('service_role',c.oid,'SELECT') end as service_direct_read,
       case when c.oid is null then null else has_table_privilege('authenticated',c.oid,'SELECT') end as authenticated_direct_read
from (values ('account_billing_analytics_consent'),('account_export_analytics'),('account_export_analytics_events')) expected(name)
left join pg_namespace n on n.nspname='public'
left join pg_class c on c.relnamespace=n.oid and c.relname=expected.name and c.relkind='r';

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer, p.proconfig as function_settings,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (p.proname in (
 'billing_analytics_choice','record_account_billing_analytics','analytics_identity_aliases_safe',
 'lock_account_export_analytics','begin_account_export_analytics','save_account_export_analytics',
 'restart_account_export_analytics','finish_account_export_analytics','account_export_analytics_ready',
 'read_account_export_chunk','read_account_export','authorize_account_export_send')
 or p.proname like 'account_export_dataset%') order by p.proname;

select t.relname as table_name, con.conname, con.contype,
       pg_get_constraintdef(con.oid) as definition
from pg_constraint con join pg_class t on t.oid=con.conrelid
join pg_namespace n on n.oid=t.relnamespace
where n.nspname='public' and t.relname in ('account_billing_analytics_consent','account_export_analytics','account_export_analytics_events')
order by t.relname, con.conname;

select schemaname, tablename, indexname, indexdef from pg_indexes
where schemaname='public' and tablename in ('account_billing_analytics_consent','account_export_analytics','account_export_analytics_events')
order by tablename,indexname;

-- If cron.job exists, separately inspect only jobid/jobname/active/schedule for
-- job 32 and maintenance. Never select command: it can contain credentials.
