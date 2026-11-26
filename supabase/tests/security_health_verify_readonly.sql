-- Read-only rollout verification. No worker commands, payloads or credentials.
select t.tablename, r.role_name, p.privilege,
 has_table_privilege(r.role_name,format('public.%I',t.tablename),p.privilege) as allowed
from (values ('circle_prompts'),('comment_likes'),('comments'),('likes'),('posts'),
 ('recipes'),('saved_posts'),('user_saved_recipes'),('workouts')) t(tablename)
cross join (values ('anon'),('authenticated'),('service_role')) r(role_name)
cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
order by 1,2,3;

select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 p.prosecdef as security_definer,p.proconfig,pg_get_userbyid(p.proowner) as owner,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as member_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
 'complete_task','handle_daily_checkin','get_comment_author_names','can_save_recipe',
 'can_access_cook_together_recipe','can_read_community_post','can_read_community_comment',
 'current_user_has_pro_workout_access','is_circle_member','write_health_daily_totals',
 'sync_native_health_daily_data','upsert_apple_health_daily_data','upsert_health_connect_daily_data',
 'invoke_analytics_worker','invoke_moderation_worker','invoke_notification_dispatch',
 'invoke_notification_event','invoke_privacy_worker','invoke_wearable_sync') order by 2,3;

select schemaname,tablename,policyname,roles,cmd,permissive,qual,with_check
from pg_policies where schemaname='public' and tablename in (
 'workouts','recipes','posts','comments','user_integrations','body_metrics','sleep_logs')
order by tablename,policyname;

select n.nspname,r.role_name,has_schema_privilege(r.role_name,n.oid,'USAGE') as usage
from pg_namespace n cross join (values ('anon'),('authenticated')) r(role_name) where n.nspname='net';
select p.proname,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as member_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='net';
select c.relname,r.role_name,p.privilege,has_table_privilege(r.role_name,c.oid,p.privilege) as allowed
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join (values ('anon'),('authenticated')) r(role_name)
cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(privilege)
where n.nspname='net' and c.relkind in ('r','p') order by 1,2,3;
