import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const container=process.env.ANALYTICS_EXPORT_TEST_CONTAINER;
const db=`remote_export_${Date.now()}`;
const sql=s=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-At'],{input:s,encoding:'utf8'}).trim();
const source=p=>readFileSync(`supabase/migrations/${p}`,'utf8');
const foundation=source('20261118160000_account_privacy_foundation.sql');
const capture=source('20261118161000_account_export_capture.sql');
const deletion=source('20261118162000_account_deletion_cleanup.sql');
const fn=(text,name)=>{const start=text.indexOf(`create function public.${name}(`);assert.ok(start>=0);const end=text.indexOf('end $$;',start);return text.slice(start,end+7);};
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const op='33333333-3333-4333-8333-333333333333',lease='44444444-4444-4444-8444-444444444444',event='55555555-5555-4555-8555-555555555555';
const prefix=`set request.jwt.claim.role='service_role';`;
test('real SQL: private staging, immutable finalization, dedupe, guards, retention and legacy handoff',{skip:!container},async()=>{
 assert.match(container,/^dadhealth-analytics-(?:export-)?local-/);
 execFileSync('docker',['exec',container,'createdb','-U','postgres',db]);
 try {
 sql(`create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
 do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;create role anon;create role authenticated;end if;end $$;`);
 sql(foundation.slice(foundation.indexOf('create table public.account_privacy_operations'),foundation.indexOf('create function public.confirm_account_privacy_operation')));
 sql(capture.slice(capture.indexOf('create table public.account_export_artifacts'),capture.indexOf('-- A callback')));
 sql(`create table public.account_privacy_delivery_failures(message_id text,created_at timestamptz);`);
 for(const name of ['read_account_export','read_account_export_chunk','authorize_account_export_send']) sql(fn(capture,name));
 sql(fn(deletion,'cleanup_account_privacy_retention'));
 sql(source('20261126131000_account_export_remote_analytics.sql'));
 sql(`insert into auth.users values('${owner}','fixture@example.invalid',now()),('${other}',null,null);
 insert into account_privacy_operations(id,user_id,kind,state,recovery_hash,destination,lease_token,lease_until)
 values('${op}','${owner}','export','processing',repeat('a',64),'fixture@example.invalid','${lease}',now()+interval '5 minutes');
 insert into account_export_artifacts(operation_id,user_id,payload) values('${op}','${owner}',
 jsonb_build_object('generatedAt',now(),'sections',jsonb_build_object('optionalAnalytics',jsonb_build_array(jsonb_build_object('id','${event}','event','app_opened','properties',jsonb_build_object('saved',null),'deliveryState','pending')))));`);
 sql(`update account_privacy_operations set checkpoint='{"remoteAnalyticsExport":1}' where id='${op}';`);
 assert.equal(sql(prefix+`select read_account_export_chunk('${op}','${owner}') is null;`).split('\n').at(-1),'t');
 assert.equal(sql(prefix+`select authorize_account_export_send('${op}','${lease}') is null;`).split('\n').at(-1),'t');
 sql(`update account_privacy_operations set checkpoint='{"remoteAnalyticsExport":1}' where id='${op}';`);
 const initial=JSON.parse(sql(prefix+`select begin_account_export_analytics('${op}','${lease}');`).split('\n').at(-1));
 const state={...initial.state,phase:'complete',aliases:[owner],profiles:[],count:1,verifyCount:1,hash:'fixture',verifyHash:'fixture'};
 const record={id:event,event:'app_opened',timestamp:initial.state.cutoff,distinctId:owner,properties:{remote:null}};
 const save=(revision,s=state,records=[record])=>prefix+`select save_account_export_analytics('${op}','${lease}',${revision},'${JSON.stringify(s)}','${JSON.stringify(records)}');`;
 assert.throws(()=>sql(save(0,{...state,aliases:[owner,other]})));
 assert.throws(()=>sql(`set request.jwt.claim.role='authenticated';select begin_account_export_analytics('${op}','${lease}');`));
 assert.equal(sql(`select has_table_privilege('service_role','account_export_analytics_events','SELECT');`),'f');
 assert.equal(sql(`select has_function_privilege('service_role','read_account_export_chunk_before_remote(uuid,uuid,integer,integer)','EXECUTE');`),'f');
 sql(save(0));assert.throws(()=>sql(save(0))); // stale/lost-response replay cannot duplicate
 const restarted=JSON.parse(sql(prefix+`select restart_account_export_analytics('${op}','${lease}',1);`).split('\n').at(-1));
 assert.equal(restarted.revision,2);assert.equal(restarted.state.rebuilds,1);
 assert.equal(restarted.state.cutoff,initial.state.cutoff);
 assert.equal(sql(`select count(*) from account_export_analytics_events;`),'0');
 assert.throws(()=>sql(prefix+`select restart_account_export_analytics('${op}','${lease}',1);`));
 assert.throws(()=>sql(save(2))); // Rebuild counter cannot be silently cleared.
 state.rebuilds=1;sql(save(2));
 sql(prefix+`select finish_account_export_analytics('${op}','${lease}');`);
 const result=JSON.parse(sql(prefix+`select read_account_export('${op}','${owner}');`).split('\n').at(-1));
 assert.equal(result.sections.optionalAnalytics.length,1);assert.equal(result.sections.optionalAnalytics[0].localCapture.deliveryState,'pending');
 assert.equal(result.sections.optionalAnalytics[0].properties.remote,null);assert.equal(result.sections.optionalAnalytics[0].localCapture.properties.saved,null);
 assert.equal(sql(`select count(*) from account_export_analytics_events;`),'0');
 assert.throws(()=>sql(save(1)));
 assert.equal(sql(prefix+`select read_account_export('${op}','${other}') is null;`).split('\n').at(-1),'t');
 sql(prefix+`select authorize_account_export_send('${op}','${lease}');`);
 sql(`delete from account_export_analytics where operation_id='${op}';`);
 assert.equal(sql(prefix+`select begin_account_export_analytics('${op}','${lease}')->>'ready';`).split('\n').at(-1),'true');
 // Even handed-off legacy exports retain expiry and deletion checks.
 // Independent connections: deletion holds the canonical lock; a stale export
 // request waits, then observes the committed tombstone and cannot resume.
 const openSession=(name,query)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-At']);
  let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',()=>{});
  const done=new Promise(resolve=>child.on('close',code=>resolve(code)));
  child.stdin.write(`set application_name='${name}';${prefix}${query}\n`);
  return {child,done,output:()=>output};
 };
 const until=async(check)=>{for(let i=0;i<50;i++){if(check())return;await new Promise(r=>setTimeout(r,50));}assert.fail('Expected lock transition');};
 const deleting=openSession('remote_export_deleting',`begin;select pg_advisory_xact_lock(hashtextextended('account-privacy:${owner}',0));insert into account_deletion_tombstones(user_id,operation_id) values('${owner}','${op}');select 'LOCKED';`);
 let racing;
 try {
  await until(()=>deleting.output().includes('LOCKED'));
  racing=openSession('remote_export_racing',`select begin_account_export_analytics('${op}','${lease}');`);racing.child.stdin.end();
  await until(()=>sql("select count(*) from pg_stat_activity where application_name='remote_export_racing' and wait_event='advisory'")==='1');
  deleting.child.stdin.end('commit;\n');assert.equal(await deleting.done,0);assert.notEqual(await racing.done,0);
 } finally {if(!deleting.child.stdin.writableEnded)deleting.child.stdin.end('rollback;\n');if(racing&&!racing.child.stdin.writableEnded)racing.child.stdin.end();}

 assert.equal(sql(prefix+`select read_account_export('${op}','${owner}') is null;`).split('\n').at(-1),'t');
 assert.throws(()=>sql(prefix+`select begin_account_export_analytics('${op}','${lease}');`));
 sql(prefix+`select cleanup_account_privacy_retention();`);assert.equal(sql(`select count(*) from account_export_artifacts;`),'0');
 // Expired artifacts cascade staging, independent of remote delivery flags.
 sql(`delete from account_deletion_tombstones;update account_privacy_operations set handoff_at=null where id='${op}';
 insert into account_export_artifacts(operation_id,user_id,payload) values('${op}','${owner}','{"generatedAt":"2026-11-21T00:00:00Z","sections":{}}');`);
 sql(prefix+`select begin_account_export_analytics('${op}','${lease}');`);
 sql(`update account_export_artifacts set expires_at=now()-interval '1 second';`);
 sql(prefix+`select cleanup_account_privacy_retention();`);assert.equal(sql(`select count(*) from account_export_analytics;`),'0');
 } finally {execFileSync('docker',['exec',container,'dropdb','-U','postgres',db]);}
});
