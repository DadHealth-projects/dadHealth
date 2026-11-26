-- READ ONLY: one JSON result. Save privately as security-before.json.
-- No account data, worker invocation, cron commands or Vault values.
-- cron.job and supabase_migrations.schema_migrations were already confirmed present.
with tables as (
 select c.*, n.nspname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in ('circle_prompts','comment_likes','comments','likes','posts','recipes','saved_posts','user_saved_recipes','workouts')
), changed_functions as (
 select p.*, n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.oid in (
 to_regprocedure('public.complete_task(uuid,text)'),to_regprocedure('public.handle_daily_checkin(uuid,integer,numeric)'),
 to_regprocedure('public.get_comment_author_names(uuid[])'),to_regprocedure('public.can_save_recipe(uuid)'))
), objects as (
 select 'TABLE'::text kind,format('%I.%I',nspname,relname) identity,relowner owner,
 coalesce(relacl,acldefault('r',relowner)) acl, array['PUBLIC','anon','authenticated','service_role'] roles from tables
 union all select 'FUNCTION',format('%I.%I(%s)',nspname,proname,pg_get_function_identity_arguments(oid)),proowner,
 coalesce(proacl,acldefault('f',proowner)),array['PUBLIC','anon','authenticated','service_role'] from changed_functions
 union all select 'SCHEMA',quote_ident(nspname),nspowner,coalesce(nspacl,acldefault('n',nspowner)),array['PUBLIC','anon','authenticated'] from pg_namespace where nspname='net'
 union all select case when c.relkind='S' then 'SEQUENCE' else 'TABLE' end,format('%I.%I',n.nspname,c.relname),c.relowner,
 coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner)),array['PUBLIC','anon','authenticated']
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='net' and c.relkind in ('r','p','S')
 union all select 'FUNCTION',format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),p.proowner,
 coalesce(p.proacl,acldefault('f',p.proowner)),array['PUBLIC','anon','authenticated'] from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='net'
), function_details as (
 select p.proname,format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) identity,
 pg_get_function_result(p.oid) result,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,p.proacl,
 pg_get_functiondef(p.oid) definition,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
 p.proname in ('complete_task','handle_daily_checkin','get_comment_author_names','can_save_recipe','update_streak',
 'can_read_community_post','can_read_community_comment','community_author_visible','community_target_author',
 'can_access_cook_together_recipe','current_user_has_pro_workout_access','is_circle_member')
), workers as (
 select p.oid,p.proname,p.proowner,p.prosecdef,p.proconfig,p.proacl,pg_get_function_identity_arguments(p.oid) args,
 md5(pg_get_functiondef(p.oid)) definition_hash
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'invoke_%'
)
select jsonb_build_object(
 'snapshot_version',1,'captured_at',clock_timestamp(),'database',current_database(),
 'functions',coalesce((select jsonb_agg(to_jsonb(f) order by identity) from function_details f),'[]'::jsonb),
 'rollback_functions',coalesce((select jsonb_agg(jsonb_build_object('identity',format('%I.%I(%s)',nspname,proname,pg_get_function_identity_arguments(oid)),
 'definition',pg_get_functiondef(oid),'owner',pg_get_userbyid(proowner)) order by proname) from changed_functions),'[]'::jsonb),
 'rollback_acl',coalesce((select jsonb_agg(jsonb_build_object('kind',o.kind,'identity',o.identity,'owner',pg_get_userbyid(o.owner),'roles',o.roles,
 'grants',coalesce((select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
 'privilege',a.privilege_type,'grantable',a.is_grantable,'grantor',pg_get_userbyid(a.grantor)) order by a.grantee,a.privilege_type)
 from aclexplode(o.acl) a where (case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end)=any(o.roles)),'[]'::jsonb)) order by o.kind,o.identity) from objects o),'[]'::jsonb),
 'table_permissions',coalesce((select jsonb_agg(jsonb_build_object('table',t.relname,'role',r.name,'privilege',v.name,
 'effective',has_table_privilege(r.name,t.oid,v.name)) order by t.relname,r.name,v.name)
 from tables t cross join (values('anon'),('authenticated'),('service_role')) r(name)
 cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(name)),'[]'::jsonb),
 'rls',coalesce((select jsonb_agg(jsonb_build_object('table',relname,'enabled',relrowsecurity,'forced',relforcerowsecurity) order by relname) from tables),'[]'::jsonb),
 'policies',coalesce((select jsonb_agg(to_jsonb(p) order by p.tablename,p.policyname) from pg_policies p where p.schemaname='public' and p.tablename in
 ('circle_prompts','comment_likes','comments','likes','posts','recipes','saved_posts','user_saved_recipes','workouts','daily_tasks','mood_logs','sleep_logs')),'[]'::jsonb),
 'policy_function_dependencies',coalesce((select jsonb_agg(jsonb_build_object('table',c.relname,'policy',p.polname,'function',f.oid::regprocedure::text))
 from pg_policy p join pg_class c on c.oid=p.polrelid join pg_depend d on d.classid='pg_policy'::regclass and d.objid=p.oid
 join pg_proc f on d.refclassid='pg_proc'::regclass and d.refobjid=f.oid where p.polrelid in(select oid from tables)),'[]'::jsonb),
 'comment_anonymous', (select jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid))
 from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
 where a.attrelid=to_regclass('public.comments') and a.attname='anonymous' and not a.attisdropped),
 'ownership_write_dependencies',coalesce((select jsonb_agg(jsonb_build_object('table',c.relname,'constraint',con.conname,'definition',pg_get_constraintdef(con.oid)))
 from pg_constraint con join pg_class c on c.oid=con.conrelid where con.conrelid in(to_regclass('public.daily_tasks'),to_regclass('public.mood_logs'),to_regclass('public.sleep_logs'))),'[]'::jsonb),
 'role_membership',coalesce((select jsonb_agg(jsonb_build_object('member',pg_get_userbyid(member),'role',pg_get_userbyid(roleid),'admin',admin_option)) from pg_auth_members),'[]'::jsonb),
 'net_effective',jsonb_build_object(
 'schema',(select jsonb_agg(jsonb_build_object('role',r.name,'usage',has_schema_privilege(r.name,n.oid,'USAGE'))) from pg_namespace n cross join(values('anon'),('authenticated'),('service_role'),('postgres'))r(name) where n.nspname='net'),
 'functions',(select jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'role',r.name,'execute',has_function_privilege(r.name,p.oid,'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join(values('anon'),('authenticated'),('service_role'),('postgres'))r(name) where n.nspname='net'),
 'relations',(select jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'role',r.name,'privilege',v.name,'allowed',case when c.relkind='S' then has_sequence_privilege(r.name,c.oid,v.name) else has_table_privilege(r.name,c.oid,v.name) end))
 from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join(values('anon'),('authenticated'),('service_role'),('postgres'))r(name)
 cross join(values('SELECT'),('UPDATE'),('USAGE'),('INSERT'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'))v(name)
 where n.nspname='net' and c.relkind in('r','p','S') and ((c.relkind='S' and v.name in('SELECT','UPDATE','USAGE')) or(c.relkind<>'S' and v.name<>'USAGE')))),
 'workers',coalesce((select jsonb_agg(jsonb_build_object('name',proname,'arguments',args,'owner',pg_get_userbyid(proowner),'security_definer',prosecdef,'settings',proconfig,
 'acl',proacl,'definition_hash',definition_hash,'anon_execute',has_function_privilege('anon',oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',oid,'EXECUTE')) order by proname,args) from workers),'[]'::jsonb),
 'jobs',coalesce((select jsonb_agg(jsonb_build_object('id',jobid,'name',jobname,'username',username,'schedule',schedule,'active',active,'command_hash',md5(command)) order by jobid) from cron.job),'[]'::jsonb),
 'migration_history',coalesce((select jsonb_agg(jsonb_build_object('version',version)) from supabase_migrations.schema_migrations where version='20261126120000'),'[]'::jsonb)
) as security_preflight;
