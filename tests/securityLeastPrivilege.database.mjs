import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildRollback } from '../scripts/security-migration-rollback.mjs';
const container='dadhealth-security-health-test', db='security_only_'+process.pid;
const file=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function run(text,database=db){return spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'});}
function sql(text,database=db){const r=run(text,database);assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
const migration=file('supabase/migrations/20261126120000_security_least_privilege.sql');
const snapshot=()=>JSON.parse(sql(file('supabase/tests/security_least_privilege_preflight.sql')));
const reader='00000000-0000-0000-0000-000000000001',author='00000000-0000-0000-0000-000000000002';
const post='30000000-0000-0000-0000-000000000001',comment='40000000-0000-0000-0000-000000000001',circle='20000000-0000-0000-0000-000000000001';
const member=`set role authenticated;set request.jwt.claim.sub='${reader}';`;
const names=()=>sql(member+`select count(*) from get_comment_author_names(array['${author}'::uuid]);`);
test('security-only migration, attribution boundaries and snapshot rollback',{skip:process.env.RUN_SECURITY_ONLY_DB!=='1'},async t=>{
 sql(`create database ${db}`,'postgres');
 const fixture=file('supabase/tests/security_health_fixture.sql').replace('create role anon; create role authenticated; create role service_role bypassrls;',
 () => "do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;create role authenticated;create role service_role bypassrls;end if;end $$;");
 sql(fixture);
 sql(`create schema cron;create table cron.job(jobid bigint,jobname text,username text,schedule text,active boolean,command text);
 insert into cron.job values(32,'optional-analytics-worker','postgres','* * * * *',false,'fixture only');
 create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text);
 create function complete_task(p_user_id uuid,p_title text) returns void language sql as $$select$$;
 create function handle_daily_checkin(p_user_id uuid,p_mood int,p_sleep numeric) returns void language sql as $$select$$;
 create function get_comment_author_names(p_user_ids uuid[]) returns table(user_id uuid,display_name text) language sql as $$select null::uuid,null::text where false$$;
 grant execute on function can_save_recipe(uuid) to authenticated,service_role;
 alter table posts add column circle_id uuid;alter table comments add column post_id uuid;
 create table circles(id uuid,visibility text);create table circle_members(circle_id uuid,user_id uuid);
 create table community_blocks(user_id uuid,blocked_user_id uuid);create table anonymous_post_owners(post_id uuid,user_id uuid);
 create function is_circle_member(uuid) returns boolean language sql stable security definer as $$select exists(select 1 from circle_members where circle_id=$1 and user_id=auth.uid())$$;`);
 const source=file('supabase/migrations/20261119120000_community_report_block.sql');
 for(const name of ['community_target_author','community_author_visible','can_read_community_post','can_read_community_comment']){
  const match=source.match(new RegExp('create (?:or replace )?function public\\.'+name+'\\([\\s\\S]*?\\$\\$;'));assert.ok(match,name);sql(match[0]);
 }
 const before=snapshot();const rollback=buildRollback(before);
 await t.test('migration failure is atomic',()=>{
  const r=run(migration.replace(/commit;\s*$/i,"select 1/0;commit;"));assert.notEqual(r.status,0);
  assert.deepEqual(snapshot().rollback_acl,before.rollback_acl);assert.deepEqual(snapshot().rollback_functions,before.rollback_functions);
 });
 sql(migration);
 await t.test('inherited PUBLIC writes removed; guest SELECT and member CRUD preserved',()=>{
  const after=snapshot();for(const p of after.table_permissions)assert.equal(p.effective,p.role==='anon'?p.privilege==='SELECT':['SELECT','INSERT','UPDATE','DELETE'].includes(p.privilege),JSON.stringify(p));
  assert.deepEqual(after.policies,before.policies);assert.deepEqual(after.jobs,before.jobs);
  assert.equal(after.functions.find(f=>f.proname==='can_save_recipe').authenticated_execute,true);
  assert.equal(after.net_effective.schema.find(r=>r.role==='anon').usage,false);
  assert.ok(after.net_effective.functions.filter(r=>['anon','authenticated'].includes(r.role)).every(r=>!r.execute));
  assert.ok(after.net_effective.relations.filter(r=>['anon','authenticated'].includes(r.role)).every(r=>!r.allowed));
 });
 sql(`insert into user_profile values('${author}','Fixture');insert into posts(id,user_id,anonymous,visible)values('${post}','${author}',true,true);`);
 await t.test('anonymous post alone and unrelated UUID cannot disclose identity',()=>{
  assert.equal(names(),'0');assert.equal(sql(member+`select count(*) from get_comment_author_names(array['99999999-9999-4999-8999-999999999999'::uuid]);`),'0');
 });
 sql(`insert into comments(id,user_id,anonymous,visible,post_id)values('${comment}','${author}',true,true,'${post}');`);
 await t.test('anonymous comment cannot independently authorize identity',()=>{assert.equal(names(),'0');});
 await t.test('visible named comment including legacy null and named post authorize identity',()=>{
  sql('update comments set anonymous=false');assert.equal(names(),'1');sql('update comments set anonymous=null');assert.equal(names(),'1');
  sql('update comments set anonymous=true;update posts set anonymous=false');assert.equal(names(),'1');
 });
 await t.test('private circles and blocks remain effective for named comments',()=>{
  sql(`update posts set anonymous=true,circle_id='${circle}';update comments set anonymous=false;insert into circles values('${circle}','private');`);assert.equal(names(),'0');
  sql(`insert into circle_members values('${circle}','${reader}');`);assert.equal(names(),'1');
  sql(`insert into community_blocks values('${reader}','${author}');`);assert.equal(names(),'0');
  sql('delete from community_blocks;update comments set removed_at=now()');assert.equal(names(),'0');
 });
 await t.test('unauthenticated and foreign-owner writes rejected; own-user operation preserved',()=>{
  assert.notEqual(run('set role anon;select * from get_comment_author_names(array[]::uuid[]);').status,0);
  assert.notEqual(run('set role authenticated;select * from get_comment_author_names(array[]::uuid[]);').status,0);
  for(const q of [`select complete_task('${author}','fixture');`,`select handle_daily_checkin('${author}',3,7);`])assert.notEqual(run(member+q).status,0);
  sql(member+`select complete_task('${reader}','fixture');select handle_daily_checkin('${reader}',3,7);`);
  assert.equal(sql('select count(*) from daily_tasks'),'1');
  sql(`set role service_role;select complete_task('${author}','service fixture');select handle_daily_checkin('${author}',3,7);`);
  assert.equal(sql('select count(*) from daily_tasks'),'2');
 });
 await t.test('null and oversized author requests rejected without disclosing rows',()=>{
  for(const value of ['null',`array_fill('${author}'::uuid,array[201])`]){
   const result=run(member+`select * from get_comment_author_names(${value});`);
   assert.notEqual(result.status,0);assert.match(result.stderr,/Invalid author request/);
  }
  assert.equal(sql(member+'select count(*) from get_comment_author_names(array[]::uuid[]);'),'0');
 });
 await t.test('postflight query is read-only and reports security boundary checks',()=>{
  const result=JSON.parse(sql('begin read only;'+file('supabase/tests/security_least_privilege_postflight.sql')+'commit;'));
  assert.equal(result.checks.anonymous_table_writes_denied,true);assert.equal(result.checks.anonymous_comment_guard_present,true);
  assert.equal(result.checks.analytics_job_32_inactive,true);assert.equal(result.checks.migration_recorded,false);
 });
 await t.test('rollback needs explicit opt-in and restores exact fixture definitions/effective ACLs',()=>{
  assert.notEqual(run(rollback).status,0);
  sql("set dadhealth.security_rollback_approved='yes';"+rollback);
  const restored=snapshot();assert.deepEqual(restored.rollback_functions,before.rollback_functions);
  assert.deepEqual(restored.rollback_acl,before.rollback_acl);assert.deepEqual(restored.policies,before.policies);assert.deepEqual(restored.jobs,before.jobs);
 });
 await t.test('actual guest workout/recipe policies preserve Free and Pro access',()=>{
  sql(`alter table workouts add primary key(id);alter table workouts add column source text;alter table workouts add column user_id uuid;
   create function user_has_pro_access(uuid) returns boolean language sql stable security definer as $$select $1='${author}'::uuid$$;
   alter table recipes add column cook_together boolean;create table free_weekly_recipe_assignments(week_start date,recipe_id uuid);
   grant select on free_weekly_recipe_assignments to anon,authenticated;alter table recipes enable row level security;`);
  sql(file('supabase/migrations/20261016150000_weekly_free_workout_assignment.sql'));
  const recipe=file('supabase/migrations/20261016160000_cook_together_weekly_access.sql');
  sql(recipe.slice(recipe.indexOf('create or replace function public.can_access_cook_together_recipe'),recipe.indexOf('create or replace function public.admin_set_free_weekly_recipe')));
  for(const name of ['Read eligible Cook Together recipes','Restrict Cook Together recipe reads to Pro or weekly assignment']){
   const match=recipe.match(new RegExp('create policy "'+name+'"[\\s\\S]*?;'));assert.ok(match);sql(match[0]);
  }
  sql(migration);
  sql(`insert into workouts values('${post}','admin',null),('${comment}','admin',null);
   insert into recipes values('${post}',true),('${comment}',true);
   insert into free_weekly_workout_assignments(week_start,workout_id) values(date_trunc('week',current_date)::date,'${post}');
   insert into free_weekly_recipe_assignments values(date_trunc('week',current_date)::date,'${post}');`);
  for(const table of ['workouts','recipes']){
   assert.equal(sql(`set role anon;select count(*) from ${table}`),'1');
   assert.equal(sql(member+`select count(*) from ${table}`),'1');
   assert.equal(sql(`set role authenticated;set request.jwt.claim.sub='${author}';select count(*) from ${table}`),'2');
  }
 });
 sql(`drop database ${db}`,'postgres');
});
