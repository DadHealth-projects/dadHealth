-- Read-only production verification. Run manually after reviewing deployment.
-- No account values, capabilities, Vault values or private event properties.
begin read only;
select column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='public' and table_name='user_profile'
and column_name in ('goals','custody_pattern','custody_arrangement','kids_ages','onboarding_complete') order by column_name;
select conname,pg_get_constraintdef(oid) as definition from pg_constraint
where conrelid='public.user_profile'::regclass and contype='c';
select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('user_profile','analytics_consents','analytics_outbox','analytics_funnel_keys','analytics_return_cohorts','analytics_action_recovery','analytics_exposure','analytics_rate_limits');
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('user_profile','analytics_consents','analytics_outbox','analytics_funnel_keys','analytics_return_cohorts','analytics_action_recovery','analytics_exposure','analytics_rate_limits');
select p.proname,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'execute') as anonymous_execute,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
 has_function_privilege('service_role',p.oid,'execute') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('ingest_optional_analytics','claim_optional_analytics',
 'cleanup_optional_analytics','issue_analytics_consent','renew_analytics_consent','recover_analytics_actions','authorize_optional_analytics','prepare_analytics_erasure','confirm_analytics_erasure','upsert_subscription_analytics_snapshot','analytics_write_scope','enqueue_analytics_fact','record_verified_billing_analytics','account_export_dataset') order by p.proname;
select tgname,tgrelid::regclass as source,tgenabled from pg_trigger
where not tgisinternal and tgname like 'analytics_%' order by tgname;
select pg_get_functiondef(p.oid) like '%exception when lock_not_available or deadlock_detected%' as contention_correction_installed
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='analytics_write_scope';
select table_name,column_name from information_schema.columns
where table_schema='public' and table_name like 'analytics_%' order by table_name,ordinal_position;
-- Only if cron is installed: inspect scheduling without displaying commands/secrets.
select to_regclass('cron.job') is not null as cron_installed;
-- Run separately if the preceding result is true:
-- select jobname,schedule,active,command ilike '%invoke%analytics%' as invokes_analytics
-- from cron.job where jobname ilike '%analytics%';
select version from supabase_migrations.schema_migrations
where version in ('20261120120000','20261120130000','20261120140000') order by version;
select conname,pg_get_constraintdef(oid) as definition from pg_constraint
where conrelid='public.subscription_trial_periods'::regclass order by conname;
select has_function_privilege('service_role','public.account_export_dataset(uuid)','execute') as private_export_must_be_false;
select has_table_privilege('authenticated','public.analytics_action_recovery','select') as recovery_read_must_be_false,
 has_table_privilege('authenticated','public.analytics_exposure','select') as exposure_read_must_be_false;
rollback;
