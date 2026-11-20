// Opt-in disposable database harness: no remote connection or provider operations.
import {readFileSync} from 'node:fs';
import test from 'node:test';import assert from 'node:assert/strict';import {spawn,spawnSync} from 'node:child_process';
const container=process.env.COMMUNITY_TEST_CONTAINER;
const database=process.env.COMMUNITY_TEST_DATABASE??'postgres';
if(!['postgres','phase2_review_test'].includes(database))throw Error('Disposable database only');
if(!container||!/^dadhealth-.*test$/.test(container))throw Error('Set COMMUNITY_TEST_CONTAINER to an explicitly disposable dadhealth-...test container.');
function sql(text){const r=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],{input:text,encoding:'utf8'});if(r.status)throw Error(r.stderr);return r.stdout.trim();}
function session(text){const p=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1']);let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.stdin.end(text);return new Promise((resolve,reject)=>p.on('close',code=>code?reject(Error(err)):resolve(out.trim())));}
const a='b4000000-0000-4000-8000-000000000001',b='b4000000-0000-4000-8000-000000000002',post='b4000000-0000-4000-8000-000000000020';
const actor=`set role authenticated;set request.jwt.claim.sub='${a}';`;
const report=`select submit_community_report('post','${post}','spam','fixture')->>'id';`;
async function until(check){for(let n=0;n<30;n++){if(check())return;await new Promise(r=>setTimeout(r,100));}throw Error('Expected real database contention was not observed');}
test('independent connections contend on report lock and return one immutable receipt',async()=>{
 sql(`insert into auth.users(id,email,raw_user_meta_data) values('${a}','concurrency-a@example.invalid','{}'),('${b}','concurrency-b@example.invalid','{}');insert into posts(id,user_id,content,tag) values('${post}','${b}','concurrency fixture','general');`);
 try{
 const first=session(`begin;set application_name='b2_report_a';${actor}select pg_advisory_xact_lock(hashtextextended('community-report:${a}',0));select pg_sleep(3);${report}commit;`);
 await until(()=>sql("select count(*) from pg_stat_activity where application_name='b2_report_a' and wait_event='PgSleep'")==='1');
 const second=session(`set application_name='b2_report_b';${actor}${report}`);
 await until(()=>sql("select count(*) from pg_stat_activity where application_name='b2_report_b' and wait_event='advisory'")==='1');
 const [one,two]=await Promise.all([first,second]);assert.equal(one.trim(),two.trim());assert.match(two,/^[a-f0-9-]{36}$/);
 assert.equal(sql(`select count(*) from community_reports where user_id='${a}'`),'1');assert.equal(sql(`select count(*) from community_report_delivery where report_id='${two}'`),'1');
 console.log('Observed b2_report_b wait_event=advisory; both sessions returned the same receipt.');
 const claimed=session(`begin;set application_name='b2_worker_a';set role service_role;set request.jwt.claim.role='service_role';select claim_community_report_delivery()->>'id';select pg_sleep(2);rollback;`);
 await until(()=>sql("select count(*) from pg_stat_activity where application_name='b2_worker_a' and wait_event='PgSleep'")==='1');
 const overlap=await session("set role service_role;set request.jwt.claim.role='service_role';select claim_community_report_delivery() is null;");assert.equal(overlap,'t');await claimed;
 assert.equal(sql(`select state from community_report_delivery where report_id='${two}'`),'queued');
 console.log('Overlapping worker skipped a locked row; rollback restored queued state.');
 sql(`delete from community_reports where user_id='${a}';`);
 await session(`begin;${actor}${report}rollback;`);assert.equal(sql(`select count(*) from community_reports where user_id='${a}'`),'0');
 assert.match(await session(actor+report),/^[a-f0-9-]{36}$/);
 console.log('Rolled-back report left no partial report/outbox; fresh retry succeeded.');
 }finally{sql(`delete from posts where id='${post}';delete from auth.users where id in ('${a}','${b}');`);}
});

test('concurrent trusted prompt imports publish 24 ordinary posts exactly once',async()=>{
 const publisher='b5000000-0000-4000-8000-000000000001';
 const prompts=JSON.parse(readFileSync(new URL('../supabase/seeds/jamie-circle-prompts-20261119.json',import.meta.url),'utf8')).map(({circleId,...row})=>row);
 const names=[...new Set(prompts.map(p=>p.circle))];
 const added=sql(`insert into circles(name,icon,visibility) select name,'community','public' from (values ${names.map(n=>"('"+n+"')").join(',')}) n(name) where not exists(select 1 from circles c where lower(btrim(c.name))=lower(n.name)) returning id;`).split('\n').filter(Boolean);
 sql(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('${publisher}','seed-concurrency@example.invalid',now(),'{}');insert into community_publishers(user_id) values('${publisher}');`);
 const body=JSON.stringify(prompts).replaceAll("'","''");
 const invoke=`set role service_role;set request.jwt.claim.role='service_role';select jsonb_array_length(import_community_prompts('${body}'::jsonb,'${publisher}'));`;
 try {
  const first=session(`begin;set application_name='b3_seed_a';select pg_advisory_xact_lock(hashtextextended('community-jamie-seeds',0));select pg_sleep(3);${invoke}commit;`);
  await until(()=>sql("select count(*) from pg_stat_activity where application_name='b3_seed_a' and wait_event='PgSleep'")==='1');
  const second=session(`set application_name='b3_seed_b';${invoke}`);
  await until(()=>sql("select count(*) from pg_stat_activity where application_name='b3_seed_b' and wait_event='advisory'")==='1');
  const [one,two]=await Promise.all([first,second]);assert.equal(one.trim(),'24');assert.equal(two.trim(),'24');
  assert.equal(sql(`select count(*) from posts where user_id='${publisher}' and seeded_prompt and official_author`),'24');
  assert.equal(sql(`select count(*) from community_prompt_seeds where publisher_id='${publisher}'`),'24');
  console.log('Observed b3_seed_b advisory wait; concurrent imports produced 24 posts and 24 receipts, no duplicates.');
 } finally {
  sql(`delete from posts where user_id='${publisher}';delete from community_prompt_seeds where publisher_id='${publisher}';delete from auth.users where id='${publisher}';`);
  if(added.length)sql(`delete from circles where id in (${added.map(id=>"'"+id+"'").join(',')});`);
 }
});
