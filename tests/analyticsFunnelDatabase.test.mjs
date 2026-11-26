import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
const container=process.env.ANALYTICS_TEST_CONTAINER;
const db=`analytics_funnel_${Date.now()}`;
const args=['exec','-i',container??'', 'psql','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-At'];
const sql=s=>execFileSync('docker',args,{input:s,encoding:'utf8'}).trim();
const read=p=>readFileSync(p,'utf8');
const schema=read('supabase/schema.sql');
const role="select set_config('request.jwt.claim.role','service_role',false);";
function session(s){const p=spawn('docker',args);let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.stdin.end(s);return new Promise((resolve,reject)=>p.on('exit',code=>code?reject(Error(err)):resolve(out)));}
const tables=new Set(['auth.users']);
function installTable(name,source=schema){
 if(tables.has(name))return;
 const re=new RegExp('create table(?: if not exists)? (?:public\\.)?'+name+' \\([\\s\\S]*?\\n\\);','i');
 const definition=source.match(re)?.[0];assert.ok(definition,`actual table definition: ${name}`);
 for(const match of definition.matchAll(/references ([a-z_.]+)\(/gi))if(match[1]!==name)installTable(match[1].replace(/^public\./,''));
 sql(definition);tables.add(name);
}
function owner(){const uid=randomUUID();sql(`insert into auth.users values('${uid}');insert into user_profile(user_id) values('${uid}');`);return uid;}
function context(uid) {
 const secret=randomUUID()+randomUUID(),hash=createHash('sha256').update(secret).digest('hex');
 const issued=JSON.parse(sql(role+`select issue_analytics_consent('${uid}','${hash}')`).split('\n').at(-1));
 const cid=issued.consent;
 return {uid,cid,secret,hash,sql:`select set_config('request.jwt.claim.role','authenticated',false);select set_config('request.jwt.claim.sub','${uid}',false);select set_config('request.headers','${JSON.stringify({'x-dadhealth-analytics':JSON.stringify({owner:uid,consent:cid,secret})})}',false);`};
}
const count=(uid,event)=>Number(sql(`select count(*) from analytics_outbox where user_id='${uid}' and event='${event}'`));
function opened(c,at=new Date().toISOString(),id=randomUUID()) {return role+`select ingest_optional_analytics('${c.uid}','${c.cid}','${c.hash}','${JSON.stringify({version:1,id,event:'app_opened',timestamp:at,properties:{}})}');`;}

test('forward migrations against source-derived dependency schema, private grants and existing-history suppression',{skip:!container},()=>{
 assert.match(container,/^dadhealth-analytics-local-/);
 execFileSync('docker',['exec',container,'createdb','-U','postgres',db]);
 sql(`create schema auth;create table auth.users(id uuid primary key);
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table account_deletion_tombstones(user_id uuid primary key,operation_id uuid not null default gen_random_uuid(),accepted_at timestamptz not null default now());
 create function account_export_dataset(uuid) returns jsonb language sql as $$select '{"sections":{}}'::jsonb$$;revoke all on function account_export_dataset(uuid) from public;`);
 for(const name of ['mood_logs','workout_sessions','workout_completions','activity_logs','bond_logs','user_profile','user_streaks','subscription_entitlements','scoring_timezone_history'])installTable(name);
 installTable('present_dad_sessions',read('supabase/migrations/20260928150000_change08_present_dad_and_circle_descriptions.sql'));
 installTable('streak_reconciliation_state',read('supabase/migrations/20261114130000_checkin_streak_reconciliation.sql'));
 sql(schema.match(/alter table user_profile add column if not exists custody_pattern text;/)[0]);
 for(const column of ['kids_ages','custody_arrangement','onboarding_complete']) {
  const statement=schema.match(new RegExp('alter table user_profile add column if not exists '+column+'[^;]*;'))?.[0];
  assert.ok(statement,column);sql(statement);
 }
 const cal=read('supabase/migrations/20261111120000_mind_participation_and_scoring_calendar.sql');
 sql(cal.slice(cal.indexOf('create or replace function public.scoring_timezone_at'),cal.indexOf('revoke all on function public.scoring_timezone_at')));
 const existing=owner();sql(`insert into mood_logs(user_id,date,mood_value) values('${existing}',current_date-1,3)`);
 installTable('account_privacy_operations',read('supabase/migrations/20261118160000_account_privacy_foundation.sql'));
 function installFunction(source,name) {const start=source.search(new RegExp('create (?:or replace )?function public.'+name+'\\('));assert.ok(start>=0,name);const end=source.indexOf('$$;',source.indexOf('as $$',start));sql(source.slice(start,end+3));}
 const privacy=read('supabase/migrations/20261118160000_account_privacy_foundation.sql');
 const cleanup=read('supabase/migrations/20261118162000_account_deletion_cleanup.sql');
 installFunction(privacy,'guard_account_privacy_write');
 installFunction(privacy,'privacy_current_account_available');
 sql('alter table subscription_entitlements add constraint analytics_fixture_subscription_owner unique(id,user_id)');
 sql(read('tests/fixtures/subscription-trial-periods.sql'));
 installFunction(schema,'upsert_subscription_entitlement');
 installTable('subscription_cancellation_evidence',read('supabase/migrations/20261112180000_subscription_cancellation_feedback.sql'));
 installFunction(read('supabase/migrations/20261113120000_apple_cancellation_ordering_and_membership_read.sql'),'upsert_subscription_with_cancellation_evidence');
 sql(read('supabase/migrations/20261120120000_optional_analytics_foundation.sql'));
 sql(read('supabase/migrations/20261120130000_analytics_funnel_facts.sql'));
 sql(read('supabase/migrations/20261120140000_analytics_scope_contention.sql'));
 const c=context(existing);sql(c.sql+`insert into mood_logs(user_id,date,mood_value) values('${existing}',current_date,3)`);
 assert.equal(count(existing,'first_checkin'),0);
 assert.equal(sql("select has_table_privilege('authenticated','analytics_funnel_keys','SELECT')"),'f');
 assert.equal(sql("select has_function_privilege('service_role','enqueue_analytics_fact(uuid,uuid,text,jsonb,text,timestamptz)','EXECUTE')"),'f');
 console.log('Dependency tables/functions loaded from repository schema/migrations; not a full Supabase-stack assertion.');
});
test('committed first action is unique under independent connections; failure rolls back; no-consent history never backfills',{skip:!container},async()=>{
 const c=context(owner());
 await Promise.all([session(c.sql+`insert into mood_logs(user_id,date,mood_value) values('${c.uid}',current_date,3)`),session(c.sql+`insert into mood_logs(user_id,date,mood_value) values('${c.uid}',current_date-1,3)`)]);
 assert.equal(count(c.uid,'first_checkin'),1);
 sql(c.sql+`update mood_logs set mood_value=2 where user_id='${c.uid}'`);assert.equal(count(c.uid,'first_checkin'),1);
 const d=context(owner());sql(d.sql+`begin;insert into mood_logs(user_id,date,mood_value) values('${d.uid}',current_date,3);rollback;`);assert.equal(count(d.uid,'first_checkin'),0);
 sql(d.sql+`insert into mood_logs(user_id,date,mood_value) values('${d.uid}',current_date,3)`);assert.equal(count(d.uid,'first_checkin'),1);
 const denied=context(owner());sql(`insert into mood_logs(user_id,date,mood_value) values('${denied.uid}',current_date-1,3)`);
 sql(denied.sql+`insert into mood_logs(user_id,date,mood_value) values('${denied.uid}',current_date,3)`);assert.equal(count(denied.uid,'first_checkin'),0);
});
test('onboarding persists once; actual sessions reach fixed-zone return dates; consent withdrawal and export',{skip:!container},()=>{
 const c=context(owner());sql(c.sql+`update user_profile set goals='["fixture"]',custody_pattern='daily',timezone='Europe/London' where user_id='${c.uid}'`);
 assert.equal(count(c.uid,'onboarding_completed'),1);
 sql(c.sql+`update user_profile set display_name='fixture' where user_id='${c.uid}'`);assert.equal(count(c.uid,'onboarding_completed'),1);
 // Isolated clock fixture: no historical events are manufactured by migration.
 sql(`update analytics_return_cohorts set completed_at=clock_timestamp()-interval '2 days',day_zero=(clock_timestamp() at time zone 'Europe/London')::date-2 where user_id='${c.uid}';update user_profile set timezone='Pacific/Auckland' where user_id='${c.uid}'`);
 sql(opened(c));sql(opened(c));assert.equal(count(c.uid,'return_day_reached'),1);
 assert.equal(sql(`select timezone from analytics_return_cohorts where user_id='${c.uid}'`),'Europe/London');
 assert.equal(sql(`select account_export_dataset('${c.uid}')#>>'{sections,analyticsReturnCohort,0,timezone}'`),'Europe/London');
 sql(role+`select ingest_optional_analytics('${c.uid}','${c.cid}','${c.hash}',null,true)`);
 assert.equal(sql(`select count(*) from analytics_return_cohorts where user_id='${c.uid}'`),'0');
 sql(opened(c));assert.equal(count(c.uid,'return_day_reached'),0);
});
test('wrong-owner scope, pre-upload withdrawal, retention and deletion cannot recreate facts',{skip:!container},()=>{
 const a=context(owner()),b=context(owner());
 sql(a.sql+`insert into bond_logs(user_id,activity_type,quality) values('${b.uid}','fixture',3)`);assert.equal(count(b.uid,'first_bond_log'),0);
 sql(role+`select ingest_optional_analytics('${a.uid}','${a.cid}','${a.hash}',null,true)`);
 assert.equal(sql(`select revoked_at is not null from analytics_consents where id='${a.cid}'`),'t');
 sql(a.sql+`insert into bond_logs(user_id,activity_type,quality) values('${a.uid}','fixture',3)`);assert.equal(count(a.uid,'first_bond_log'),0);
 const c=context(owner());sql(c.sql+`insert into bond_logs(user_id,activity_type,quality) values('${c.uid}','fixture',3)`);assert.equal(count(c.uid,'first_bond_log'),1);
 sql(`update analytics_outbox set occurred_at=clock_timestamp()-interval '8 days' where user_id='${c.uid}';`+role+'select cleanup_optional_analytics()');
 sql(c.sql+`insert into bond_logs(user_id,activity_type,quality) values('${c.uid}','fixture',3)`);assert.equal(count(c.uid,'first_bond_log'),0);
 sql(role+`insert into account_deletion_tombstones(user_id) values('${c.uid}');`);
 sql(c.sql+`insert into bond_logs(user_id,activity_type,quality) values('${c.uid}','fixture',3)`);
 assert.equal(sql(`select count(*) from analytics_funnel_keys where user_id='${c.uid}'`),'0');
});

test('canonical streak replay emits 7 and 14 once and ignores scheduled reconciliation',{skip:!container},()=>{
 const streak=read('supabase/migrations/20261114130000_checkin_streak_reconciliation.sql');
 for(const t of ['streak_checkin_receipts','streak_access_evidence']) installTable(t,streak);
 installTable('user_streak_freezes');
 const calendar=read('supabase/migrations/20261111120000_mind_participation_and_scoring_calendar.sql');
 function fn(source,name){const start=source.indexOf('create or replace function public.'+name+'(');assert.ok(start>=0,name);const end=source.indexOf('$$;',source.indexOf('as $$',start));sql(source.slice(start,end+3));}
 for(const f of ['scoring_week_boundary','scoring_date_at'])fn(calendar,f);
 for(const f of ['streak_day_end','streak_access_at','build_checkin_streak','apply_checkin_streak'])fn(streak,f);
 const c=context(owner());
 sql(c.sql+`insert into streak_reconciliation_state(user_id,activation_at,start_date,evidence_from,baseline_count,baseline_last_date)
 values('${c.uid}',current_date,current_date,current_date-1,6,current_date-1);
 insert into mood_logs(user_id,date,mood_value) values('${c.uid}',current_date,3);
 insert into streak_checkin_receipts(user_id,checkin_date,received_at) values('${c.uid}',current_date,clock_timestamp());
 select apply_checkin_streak('${c.uid}',clock_timestamp());select apply_checkin_streak('${c.uid}',clock_timestamp());`);
 assert.equal(count(c.uid,'streak_reached'),1);assert.equal(sql(`select streak_count from user_streaks where user_id='${c.uid}'`),'7');
 sql(c.sql+`update streak_reconciliation_state set baseline_count=13 where user_id='${c.uid}';select apply_checkin_streak('${c.uid}',clock_timestamp());select apply_checkin_streak('${c.uid}',clock_timestamp());`);
 assert.equal(count(c.uid,'streak_reached'),2);
 const d=context(owner());sql(d.sql+`insert into streak_reconciliation_state(user_id,activation_at,start_date,evidence_from,baseline_count,baseline_last_date)
 values('${d.uid}',current_date+1,current_date+1,current_date,6,current_date);select apply_checkin_streak('${d.uid}',clock_timestamp());`);
 assert.equal(count(d.uid,'streak_reached'),0);
});
test('return-day function follows frozen London dates through GMT/BST, not elapsed 24-hour periods',{skip:!container},()=>{
 for(const [zero,at,day] of [
 ['2026-03-28','2026-03-29T22:59:59Z',1],['2026-03-28','2026-03-29T23:00:00Z',2],
 ['2026-10-24','2026-10-25T23:59:59Z',1],['2026-10-24','2026-10-26T00:00:00Z',2],
 ['2026-03-28','2026-04-03T23:00:00Z',7],['2026-03-28','2026-04-26T23:00:00Z',30]])
 assert.equal(Number(sql(`select analytics_return_day('${zero}','Europe/London','${at}')`)),day);
});
test('manual workouts and Bond, completed workouts and Present Dad share lifetime action dedupe',{skip:!container},()=>{
 const c=context(owner());
 sql(c.sql+`insert into workout_sessions(user_id,exercise_name,duration_minutes,calories,performed_at) values('${c.uid}','fixture',10,0,now());
 insert into activity_logs(user_id,client_request_id,pillar,activity_type,activity_date,duration_minutes,intensity) values('${c.uid}',gen_random_uuid(),'body','walking',current_date,10,'light');`);
 assert.equal(count(c.uid,'first_workout_logged'),1);
 const d=context(owner());sql(d.sql+`insert into bond_logs(user_id,activity_type,quality) values('${d.uid}','fixture',3);insert into bond_logs(user_id,activity_type,quality) values('${d.uid}','fixture',3)`);assert.equal(count(d.uid,'first_bond_log'),1);
 const w=context(owner()),workout=randomUUID();sql(w.sql+`insert into workouts(id,user_id,title,duration_mins,equipment,focus,source) values('${workout}','${w.uid}','fixture',10,'none','full_body','admin');insert into workout_completions(user_id,workout_id) values('${w.uid}','${workout}');insert into workout_completions(user_id,workout_id) values('${w.uid}','${workout}');`);assert.equal(count(w.uid,'first_workout_logged'),1);
 const b=context(owner()),present=randomUUID();sql(b.sql+`insert into present_dad_sessions(id,user_id,ends_at) values('${present}','${b.uid}',now()+interval '5 minutes');`);assert.equal(count(b.uid,'first_bond_log'),0);
 sql(b.sql+`update present_dad_sessions set status='completed',completed_at=clock_timestamp() where id='${present}';update present_dad_sessions set completion_acknowledged_at=clock_timestamp() where id='${present}'`);assert.equal(count(b.uid,'first_bond_log'),1);
 const manual=context(owner());sql(manual.sql+`insert into activity_logs(user_id,client_request_id,pillar,category,activity_type,activity_date,contact_day) values('${manual.uid}',gen_random_uuid(),'bond','play','lego',current_date,true)`);assert.equal(count(manual.uid,'first_bond_log'),1);
});

test('return sessions emit only days 2, 7 and 30; duplicate session deliveries cannot invent missed returns',{skip:!container},()=>{
 const c=context(owner());sql(c.sql+`update user_profile set goals='["fixture"]',custody_pattern='daily' where user_id='${c.uid}'`);
 for(const day of [1,3,7,7,8,30,30]){
  sql(`update analytics_return_cohorts set completed_at=clock_timestamp()-make_interval(days=>${day}),day_zero=current_date-${day} where user_id='${c.uid}'`);
  const id=randomUUID(),request=opened(c,new Date().toISOString(),id);sql(request);sql(request);
 }
 assert.equal(count(c.uid,'return_day_reached'),2);
 assert.equal(sql(`select string_agg(properties->>'day',',' order by (properties->>'day')::int) from analytics_outbox where user_id='${c.uid}' and event='return_day_reached'`),'7,30');
});
test('billing storage rejects clients, wrong environment and withdrawn consent; replay stays deduplicated',{skip:!container},()=>{
 const c=context(owner());sql(opened(c));const at=new Date().toISOString(),sub=randomUUID(),key='billing:'+'a'.repeat(64);
 sql(`insert into subscription_entitlements(user_id,provider,provider_subscription_id,status,environment,last_verified_at) values('${c.uid}','apple','${sub}','trialing','sandbox','${at}')`);
 const call=env=>`select record_verified_billing_analytics('${c.uid}','${c.cid}','${c.hash}','apple','${env}','${sub}','${at}','trial_started','${key}','${at}','{"provider":"apple","environment":"sandbox"}')`;
 assert.throws(()=>sql(c.sql+call('sandbox')),/Forbidden/);
 assert.match(sql(role+call('production')),/f$/);assert.match(sql(role+call('sandbox')),/t$/);assert.match(sql(role+call('sandbox')),/f$/);
 assert.equal(count(c.uid,'trial_started'),1);
 sql(role+`select ingest_optional_analytics('${c.uid}','${c.cid}','${c.hash}',null,true)`);assert.match(sql(role+call('sandbox')),/f$/);
});
test('independent deletion waits for in-transaction event and removes all new bookkeeping; late requests cannot restore it',{skip:!container},async()=>{
 const c=context(owner());let held='';
 const holder=spawn('docker',args);holder.stdout.on('data',b=>held+=b);const done=new Promise((r,j)=>{holder.on('error',j);holder.on('close',r);});
 holder.stdin.write(c.sql+`begin;insert into bond_logs(user_id,activity_type,quality) values('${c.uid}','fixture',3);select 'HELD';\n`);
 for(let i=0;i<60&&!held.includes('HELD');i++)await new Promise(r=>setTimeout(r,50));assert.match(held,/HELD/);
 const deletion=session(role+`begin;set application_name='funnel-delete';select pg_advisory_xact_lock(hashtextextended('account-privacy:${c.uid}',0));insert into account_deletion_tombstones(user_id) values('${c.uid}');commit;`);
 let waiting=false;
 for(let i=0;i<40;i++){if(sql("select count(*) from pg_stat_activity where application_name='funnel-delete' and wait_event='advisory'")==='1'){waiting=true;break;}await new Promise(r=>setTimeout(r,25));}
 holder.stdin.end('commit;\n');await done;await deletion;assert.equal(waiting,true);
 assert.equal(count(c.uid,'first_bond_log'),0);assert.equal(sql(`select count(*) from analytics_funnel_keys where user_id='${c.uid}'`),'0');
 assert.match(sql(opened(c)),/removed$/);console.log('Funnel deletion observed wait_event=advisory on independent connection.');
});


test('existing profile schema accepts no children and canonical age bands under actual owner RLS; optional analytics stays consented',{skip:!container},()=>{
 const a=owner(),b=owner();
 const policies=read('supabase/rls-policies.sql');
 const policy=policies.match(/create policy "Users can CRUD own user_profile"[\s\S]*?with check \(auth.uid\(\)::text = user_id::text\);/)[0];
 sql('alter table user_profile enable row level security;'+policy+'grant usage on schema public,auth to authenticated;grant select,update on user_profile to authenticated;');
 const session=`set role authenticated;select set_config('request.jwt.claim.role','authenticated',false);select set_config('request.jwt.claim.sub','${a}',false);`;
 sql(session+`update user_profile set goals='["goal"]',custody_pattern='no_children',custody_arrangement='no_children',kids_ages='[]',onboarding_complete=true where user_id='${a}';reset role;`);
 assert.equal(sql(`select custody_pattern from user_profile where user_id='${a}'`),'no_children');assert.equal(count(a,'onboarding_completed'),0);
 assert.equal(sql(session+`select count(*) from user_profile where user_id='${b}'`).split('\n').at(-1),'0');
 sql(session+`update user_profile set kids_ages='["teen_12_plus","toddler_0_4"]',custody_pattern='daily' where user_id='${a}';reset role;`);
 assert.equal(sql(`select kids_ages::text from user_profile where user_id='${a}'`),'["teen_12_plus", "toddler_0_4"]');
 const catalogue=read('supabase/migrations/20261118161000_account_export_capture.sql');
 assert.match(catalogue,/'user_profile',array\[[^\n]*'kids_ages'/);
 assert.equal(sql("select has_function_privilege('authenticated','account_export_dataset(uuid)','execute')"),'f');
});


test('consent lock timeout cannot consume a no-consent first-action key; successful racing saves deduplicate', {skip:!container},async()=>{
 const c=context(owner());
 let output='';const holder=spawn('docker',args);holder.stdout.on('data',b=>output+=b);
 const held=new Promise((resolve,reject)=>{holder.on('error',reject);holder.on('close',code=>code?reject(Error('lock fixture failed')):resolve());});
 holder.stdin.write(`begin;select pg_advisory_xact_lock(hashtextextended('analytics-consent:${c.cid}',0));select 'HELD';\n`);
 for(let n=0;n<100&&!output.includes('HELD');n++)await new Promise(r=>setTimeout(r,50));
 assert.match(output,/HELD/);
 sql(c.sql+`insert into mood_logs(user_id,date,mood_value) values('${c.uid}',current_date,3)`);
 assert.equal(sql(`select count(*) from mood_logs where user_id='${c.uid}'`),'1');
 assert.equal(sql(`select count(*) from analytics_funnel_keys where user_id='${c.uid}' and key='first_checkin'`),'0');
 const original=sql(`select occurred_at from analytics_action_recovery where user_id='${c.uid}'`);
 holder.stdin.end('commit;\n');await held;assert.ok(original);
 sql(role+'select recover_analytics_actions()');assert.equal(count(c.uid,'first_checkin'),1);
 assert.equal(sql(`select occurred_at from analytics_outbox where user_id='${c.uid}' and event='first_checkin'`),original);
 for(let n=0;n<5;n++){
  const race=context(owner());
  await Promise.all([session(race.sql+`insert into mood_logs(user_id,date,mood_value) values('${race.uid}',current_date,3)`),session(race.sql+`insert into mood_logs(user_id,date,mood_value) values('${race.uid}',current_date-1,3)`)]);
  assert.equal(count(race.uid,'first_checkin'),1);
 }
});

test('capabilities renew only while live; withdrawal, expiry, cleanup and deletion never revive them',{skip:!container},async()=>{
 const c=context(owner());
 const renew=role+`select renew_analytics_consent('${c.uid}','${c.cid}','${c.hash}')`;
 assert.equal(JSON.parse(sql(renew).split('\n').at(-1)).consent,c.cid);
 await Promise.all([session(renew),session(role+`select ingest_optional_analytics('${c.uid}','${c.cid}','${c.hash}',null,true)`)]);
 assert.equal(sql(renew).trim(),'service_role');
 sql(`update analytics_consents set revoked_at=clock_timestamp()-interval '31 days' where id='${c.cid}';`+role+'select cleanup_optional_analytics()');
 assert.equal(sql(`select count(*) from analytics_consents where id='${c.cid}'`),'0');
 assert.match(sql(opened(c)),/expired$/);
 assert.equal(sql(renew).trim(),'service_role');
 const e=context(owner());sql(`update analytics_consents set expires_at=clock_timestamp()-interval '1 second' where id='${e.cid}'`);
 assert.match(sql(opened(e)),/expired$/);
 assert.equal(sql(role+`select renew_analytics_consent('${e.uid}','${e.cid}','${e.hash}')`).trim(),'service_role');
 const d=context(owner());
 await Promise.all([session(role+`select renew_analytics_consent('${d.uid}','${d.cid}','${d.hash}')`),session(role+`begin;select pg_advisory_xact_lock(hashtextextended('account-privacy:${d.uid}',0));insert into account_deletion_tombstones(user_id) values('${d.uid}');commit;`)]);
 assert.equal(sql(role+`select renew_analytics_consent('${d.uid}','${d.cid}','${d.hash}')`).trim(),'service_role');
});

test('exposure is committed before handoff; unknown legacy and active leases require cleanup',{skip:!container},()=>{
 const c=context(owner());sql(opened(c));
 assert.equal(sql(`select state from analytics_exposure where user_id='${c.uid}'`),'never');
 const event=JSON.parse(sql(`update analytics_outbox set state='sending',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds' where user_id='${c.uid}' returning json_build_object('id',id,'lease',lease)`).split('\n')[0]);
 assert.match(sql(role+`select authorize_optional_analytics('${event.id}','${event.lease}')`),/t$/);
 assert.equal(sql(`select state from analytics_exposure where user_id='${c.uid}'`),'possible');
 sql(role+`insert into account_deletion_tombstones(user_id) values('${c.uid}')`);
 assert.match(sql(role+`select prepare_analytics_erasure('${c.uid}')`),/draining$/);
 sql(`update analytics_outbox set lease_until=clock_timestamp()-interval '1 second' where user_id='${c.uid}'`);
 assert.match(sql(role+`select prepare_analytics_erasure('${c.uid}')`),/required$/);
 assert.equal(sql(`select state from analytics_exposure where user_id='${c.uid}'`),'possible');
 sql(role+`select confirm_analytics_erasure('${c.uid}')`);
 assert.match(sql(role+`select prepare_analytics_erasure('${c.uid}')`),/clear$/);
 const never=owner();sql(role+`insert into account_deletion_tombstones(user_id) values('${never}')`);
 assert.match(sql(role+`select prepare_analytics_erasure('${never}')`),/clear$/);
 const legacy=owner();sql(`update analytics_exposure set state='unknown' where user_id='${legacy}'`+`;insert into account_deletion_tombstones(user_id) values('${legacy}')`);
 assert.match(sql(role+`select prepare_analytics_erasure('${legacy}')`),/required$/);
 assert.equal(sql("select has_function_privilege('service_role','account_export_dataset(uuid)','EXECUTE')"),'f');
 assert.equal(sql("select has_table_privilege('authenticated','analytics_action_recovery','SELECT')"),'f');
 assert.equal(sql(`select account_export_dataset('${legacy}')#>>'{sections,analyticsExposure,0,state}'`),'unknown');
});

test('atomic provider snapshot preserves canonical ordering and verified previous/current state',{skip:!container},async()=>{
 const uid=owner(),subscription=randomUUID();
 const snapshot={p_user_id:uid,p_provider:'stripe',p_provider_subscription_id:subscription,p_status:'trialing',p_environment:'production',p_last_verified_at:'2026-11-19T12:00:00Z',p_current_period_end:'2099-01-01T00:00:00Z',p_trial_end:'2026-11-20T12:00:00Z',p_auto_renews:true};
 const call=value=>role+`select upsert_subscription_analytics_snapshot('${JSON.stringify(value)}',null)`;
 const first=JSON.parse(sql(call(snapshot)).split('\n').at(-1));assert.equal(first.previous,null);assert.equal(first.current.status,'trialing');
 const next=JSON.parse(sql(call({...snapshot,p_status:'active',p_last_verified_at:'2026-11-20T12:00:00Z'})).split('\n').at(-1));
 assert.equal(next.previous.status,'trialing');assert.equal(next.current.status,'active');
 const stale=JSON.parse(sql(call(snapshot)).split('\n').at(-1));assert.equal(stale.current.status,'active');assert.equal(stale.previous.status,'active');
 assert.equal(sql(`select count(*) from analytics_outbox where user_id='${uid}'`),'0','billing has no inferred consent');
});

test('transient enqueue failure retains original consented receipt, export, withdrawal and seven-day suppression',{skip:!container},()=>{
 const c=context(owner());
 sql(`create function fixture_fail_enqueue() returns trigger language plpgsql as $$begin raise exception 'fixture transient failure';end$$;create trigger fixture_fail_enqueue before insert on analytics_outbox for each row execute function fixture_fail_enqueue()`);
 sql(c.sql+`insert into bond_logs(user_id,activity_type,quality) values('${c.uid}','fixture',3)`);
 assert.equal(count(c.uid,'first_bond_log'),0);
 const original=sql(`select occurred_at from analytics_action_recovery where user_id='${c.uid}'`);
 assert.ok(original);
 assert.equal(sql(`select account_export_dataset('${c.uid}')#>>'{sections,analyticsRecovery,0,event}'`),'first_bond_log');
 sql('drop trigger fixture_fail_enqueue on analytics_outbox;drop function fixture_fail_enqueue()');
 sql(role+'select recover_analytics_actions()');assert.equal(count(c.uid,'first_bond_log'),1);
 assert.equal(sql(`select occurred_at from analytics_outbox where user_id='${c.uid}'`),original);
 assert.equal(sql(`select count(*) from analytics_action_recovery where user_id='${c.uid}'`),'0');
 const revoked=context(owner());
 sql(`insert into analytics_action_recovery(user_id,fact,dedupe,properties,consent_id,occurred_at) values('${revoked.uid}','first_checkin','first_checkin','{}','${revoked.cid}',clock_timestamp())`);
 sql(role+`select ingest_optional_analytics('${revoked.uid}','${revoked.cid}','${revoked.hash}',null,true);select recover_analytics_actions()`);
 assert.equal(count(revoked.uid,'first_checkin'),0);
 assert.equal(sql(`select count(*) from analytics_funnel_keys where user_id='${revoked.uid}'`),'1');
 const aged=context(owner());sql(`insert into analytics_action_recovery(user_id,fact,dedupe,properties,consent_id,occurred_at) values('${aged.uid}','first_checkin','first_checkin','{}','${aged.cid}',clock_timestamp()-interval '8 days')`);
 sql(role+'select cleanup_optional_analytics()');assert.equal(sql(`select count(*) from analytics_action_recovery where user_id='${aged.uid}'`),'0');
 sql(aged.sql+`insert into mood_logs(user_id,date,mood_value) values('${aged.uid}',current_date,3)`);assert.equal(count(aged.uid,'first_checkin'),0);
});

test('failed exposure initialization never blocks account creation and remains unknown for deletion',{skip:!container},()=>{
 sql(`create function fixture_fail_exposure() returns trigger language plpgsql as $$begin raise exception 'fixture failure';end$$;create trigger fixture_fail_exposure before insert on analytics_exposure for each row execute function fixture_fail_exposure()`);
 const uid=owner();assert.equal(sql(`select count(*) from auth.users where id='${uid}'`),'1');
 sql('drop trigger fixture_fail_exposure on analytics_exposure;drop function fixture_fail_exposure()');
 sql(role+`insert into account_deletion_tombstones(user_id) values('${uid}')`);
 assert.match(sql(role+`select prepare_analytics_erasure('${uid}')`),/required$/);
});


test('separate account billing consent: default off, CAS, no retroactive collection, export, withdrawal and deletion', {skip:!container},async()=>{
 sql(read('supabase/migrations/20261126130000_account_billing_analytics_consent.sql'));
 sql(read('supabase/migrations/20261126132000_analytics_identity_guard.sql'));
 const uid=owner(), foreign=owner(), op=randomUUID();
 const last=s=>sql(role+s).split('\n').at(-1);
 const choice=(granted,revision,id=randomUUID())=>JSON.parse(last(`select billing_analytics_choice('${uid}',${granted},${revision},'${id}')`));
 assert.equal(JSON.parse(last(`select billing_analytics_choice('${uid}')`)).granted,false);
 assert.equal(sql("select has_table_privilege('authenticated','account_billing_analytics_consent','SELECT')"),'f');
 assert.equal(sql("select has_function_privilege('service_role','account_export_dataset(uuid)','EXECUTE')"),'f');
 assert.throws(()=>sql(`set request.jwt.claim.role='authenticated';select billing_analytics_choice('${foreign}',true,0,'${op}')`));
 const granted=choice(true,0,op);assert.equal(granted.revision,1);assert.equal(choice(true,0,op).revision,1);
 const again=choice(true,1);assert.equal(again.grantedAt,granted.grantedAt);
 assert.throws(()=>choice(false,0));
 const subscription=randomUUID();
 sql(`insert into subscription_entitlements(user_id,provider,environment,provider_subscription_id,status,last_verified_at) values('${uid}','apple','sandbox','${subscription}','trialing',now())`);
 const verified=sql(`select last_verified_at from subscription_entitlements where user_id='${uid}'`);
 const record=(at,key=randomUUID())=>`select record_account_billing_analytics('${uid}','apple','sandbox','${subscription}','${verified}','trial_started','billing:'||encode(sha256(convert_to('${key}','UTF8')),'hex'),'${at}','{"provider":"apple","environment":"sandbox"}')`;
 assert.equal(last(record('2020-01-01')),'f');
 const fact=randomUUID();assert.equal(last(record(verified,fact)),'t');assert.equal(last(record(verified,fact)),'f');
 assert.equal(count(uid,'trial_started'),1);
 const exported=JSON.parse(sql(`select account_export_dataset('${uid}')`));
 assert.equal(exported.sections.billingAnalyticsChoice[0].granted,true);
 assert.equal(JSON.stringify(exported).includes('secret_hash'),false);
 const withdrawn=choice(false,2);assert.equal(withdrawn.granted,false);assert.equal(count(uid,'trial_started'),0);
 assert.equal(last(record(verified)),'f');assert.throws(()=>choice(true,1));
 const fresh=choice(true,3);assert.ok(Date.parse(fresh.grantedAt)>=Date.parse(granted.grantedAt));
 assert.equal(last(record(granted.grantedAt)),'f');
 assert.equal(last(`select analytics_identity_aliases_safe('${uid}','["${uid}","legacy-anon"]')`),'t');
 assert.equal(last(`select analytics_identity_aliases_safe('${uid}','["${uid}","${foreign.toUpperCase()}"]')`),'f');
 sql(`insert into account_deletion_tombstones(user_id) values('${uid}')`);
 assert.equal(last(record(verified)),'f');assert.throws(()=>choice(true,4));
 sql(`delete from analytics_consents where user_id='${uid}'`); // FK cleanup cannot hit a write barrier
 sql(`delete from auth.users where id='${uid}'`);
 assert.equal(sql(`select count(*) from account_billing_analytics_consent where user_id='${uid}'`),'0');
});


test('billing consent races serialize; withdrawal wins before waiting verified fact; stale grants never revive it', {skip:!container},async()=>{
 const uid=owner();
 const choice=(value,revision,id=randomUUID())=>`select billing_analytics_choice('${uid}',${value},${revision},'${id}')`;
 const results=await Promise.allSettled([session(role+choice(true,0)),session(role+choice(false,0))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const saved=JSON.parse(sql(role+`select billing_analytics_choice('${uid}')`).split('\n').at(-1));
 if(!saved.granted)sql(role+choice(true,1));
 const current=JSON.parse(sql(role+`select billing_analytics_choice('${uid}')`).split('\n').at(-1));
 const sub=randomUUID();sql(`insert into subscription_entitlements(user_id,provider,environment,provider_subscription_id,status,last_verified_at) values('${uid}','stripe','production','${sub}','active',now())`);
 const verified=sql(`select last_verified_at from subscription_entitlements where user_id='${uid}'`);
 const record=`select record_account_billing_analytics('${uid}','stripe','production','${sub}','${verified}','subscription_cancelled','billing:'||repeat('d',64),'${verified}','{"provider":"stripe","environment":"production","reason":"unavailable"}','${current.grantedAt}')`;
 assert.equal(sql(role+record.replace(`'${current.grantedAt}')`,"'2020-01-01')")).split('\n').at(-1),'f','delayed cancellation with pre-consent observation is suppressed');
 let held='';const holder=spawn('docker',args);holder.stdout.on('data',b=>held+=b);const done=new Promise((resolve,reject)=>holder.on('close',c=>c?reject(Error('holder failed')):resolve()));
 holder.stdin.write(`${role}begin;select pg_advisory_xact_lock(hashtextextended('analytics-billing:${uid}',0));select 'HELD';\n`);
 try{
  for(let i=0;i<60&&!held.includes('HELD');i++)await new Promise(r=>setTimeout(r,50));assert.match(held,/HELD/);
  const fact=session(`${role}set application_name='billing-fact-waiter';${record}`);
  let waited=false;for(let i=0;i<30;i++){if(sql("select count(*) from pg_stat_activity where application_name='billing-fact-waiter' and wait_event='advisory'")==='1'){waited=true;break;}await new Promise(r=>setTimeout(r,50));}
  assert.equal(waited,true);holder.stdin.end(`${choice(false,current.revision)};commit;\n`);await done;
  assert.equal((await fact).trim().split('\n').at(-1),'f');assert.equal(count(uid,'subscription_cancelled'),0);
  assert.throws(()=>sql(role+choice(true,current.revision)));
 }finally{if(!holder.stdin.writableEnded)holder.stdin.end('rollback;\n');}
});
