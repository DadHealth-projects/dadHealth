\set ON_ERROR_STOP on
do $$declare t text; n text; begin
 foreach t in array array['circle_prompts','comment_likes','comments','likes','posts','recipes','saved_posts','user_saved_recipes','workouts'] loop
  perform test_assert(has_table_privilege('anon','public.'||t,'SELECT'),'guest read '||t);
  perform test_assert(not has_table_privilege('anon','public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'guest writes '||t);
  perform test_assert(has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE'),'member CRUD '||t);
  perform test_assert(has_table_privilege('service_role','public.'||t,'SELECT,INSERT,UPDATE,DELETE'),'service CRUD '||t);
 end loop;
 perform test_assert(not has_function_privilege('anon','can_save_recipe(uuid)','EXECUTE'),'save helper');
 perform test_assert(not has_schema_privilege('authenticated','net','USAGE'),'net schema');
 perform test_assert(not has_table_privilege('anon','net.http_request_queue','TRUNCATE'),'net truncate');
 perform test_assert(not has_function_privilege('authenticated','net.http_post(text)','EXECUTE'),'net direct HTTP');
 foreach n in array array['invoke_analytics_worker','invoke_moderation_worker','invoke_notification_dispatch','invoke_notification_event','invoke_privacy_worker','invoke_wearable_sync'] loop
  perform test_assert(not has_function_privilege('authenticated',n||'()','EXECUTE'),'worker denied '||n);
  execute format('select public.%I()',n);
 end loop;
 perform test_assert((select count(*)=6 from net.http_request_queue),'six owner-run workers');
end $$;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select complete_task(auth.uid(),'fixture');
select handle_daily_checkin(auth.uid(),3,7);
do $$begin
 begin perform complete_task('00000000-0000-0000-0000-000000000002','forged'); raise exception 'cross-owner allowed'; exception when insufficient_privilege then null; end;
 begin perform handle_daily_checkin('00000000-0000-0000-0000-000000000002',3,7); raise exception 'cross-owner allowed'; exception when insufficient_privilege then null; end;
 begin perform get_comment_author_names(array_fill('00000000-0000-0000-0000-000000000002'::uuid,array[201])); raise exception 'unbounded names'; exception when invalid_parameter_value then null; end;
end $$;
select test_assert((select count(*)=0 from get_comment_author_names(array['00000000-0000-0000-0000-000000000002'::uuid])),'unrelated identity hidden');
reset role;
insert into user_profile values('00000000-0000-0000-0000-000000000002','Fixture author');
insert into posts values(gen_random_uuid(),'00000000-0000-0000-0000-000000000002',true,null,true);
set role authenticated;
select test_assert((select count(*)=0 from get_comment_author_names(array['00000000-0000-0000-0000-000000000002'::uuid])),'anonymous identity hidden');
reset role;
update posts set anonymous=false,visible=false;
set role authenticated;
select test_assert((select count(*)=0 from get_comment_author_names(array['00000000-0000-0000-0000-000000000002'::uuid])),'invisible identity hidden');
reset role;
update posts set visible=true;
set role authenticated;
select test_assert((select count(*)=1 from get_comment_author_names(array['00000000-0000-0000-0000-000000000002'::uuid])),'visible author available');
select sync_native_health_daily_data('apple_health','10000000-0000-0000-0000-000000000001','[{"metric_type":"steps","value":100,"recorded_at":"2026-11-20T00:00:00Z"}]','[{"date":"2026-11-20","hours":7}]',true);
select sync_native_health_daily_data('apple_health','10000000-0000-0000-0000-000000000001','[{"metric_type":"steps","value":120,"recorded_at":"2026-11-20T00:00:00Z"}]','[{"date":"2026-11-20","hours":0}]',false);
select test_assert((select count(*)=1 and max(value)=120 from body_metrics),'correction and duplicate');
select test_assert(not exists(select 1 from sleep_logs where date='2026-11-20'),'same-source deletion');
insert into body_metrics values(auth.uid(),'steps',900,'2026-11-21T00:00:00Z','manual');
insert into sleep_logs values(auth.uid(),'2026-11-21',8,'manual');
select sync_native_health_daily_data('apple_health','10000000-0000-0000-0000-000000000001','[{"metric_type":"steps","value":1,"recorded_at":"2026-11-21T00:00:00Z"}]','[{"date":"2026-11-21","hours":0}]',false);
select test_assert((select value=900 from body_metrics where source='manual'),'manual steps preserved');
select test_assert((select hours=8 from sleep_logs where date='2026-11-21'),'manual sleep preserved');
do $$begin
 begin perform sync_native_health_daily_data('apple_health','10000000-0000-0000-0000-000000000001','[{"metric_type":"steps","value":123,"recorded_at":"2026-11-22T00:00:00Z"}]','[{"date":"2026-11-22","hours":30}]',true); raise exception 'invalid accepted'; exception when invalid_parameter_value then null; end;
 perform test_assert(not exists(select 1 from body_metrics where value=123),'invalid batch atomic');
end $$;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
do $$begin
 begin perform sync_native_health_daily_data('apple_health','10000000-0000-0000-0000-000000000001','[]','[]',true); raise exception 'foreign connection accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
select complete_task('00000000-0000-0000-0000-000000000002','service fixture');
select write_health_daily_totals('10000000-0000-0000-0000-000000000001','[{"metric_type":"steps","value":2,"recorded_at":"2026-11-21T00:00:00Z"}]','[]',true);
select test_assert((select value=900 from body_metrics where source='manual'),'legacy service manual preservation');
reset role;
select 'security and health assertions passed' as result;
