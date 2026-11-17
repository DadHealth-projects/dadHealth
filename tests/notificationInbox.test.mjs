import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
function load(path,mocks={},env={}){
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,Date,Intl,URL,Request,process:{env},console:{info(){},error(){}},require:n=>{assert.ok(n in mocks,n);return mocks[n];}});return exports;
}
const inbox=load('src/lib/notifications/inbox.ts');
test('cursor reader retrieves every row beyond API caps and continues after short pages',async()=>{
 const rows=Array.from({length:235},(_,id)=>({id})),cursors=[];
 const actual=await inbox.readNotificationRows(async(after,limit)=>{
  assert.equal(limit,100);cursors.push(after?.id??null);
  return {data:rows.filter(row=>after===null||row.id>after.id).slice(0,37),error:null};
 });
 assert.deepEqual(Array.from(actual),rows);assert.equal(cursors.at(-1),234);assert.equal(cursors.length,8);
});
test('cursor reader uses complete composite cursor across a shared owner',async()=>{
 const rows=[{user_id:'a',week:'01'},{user_id:'a',week:'02'},{user_id:'b',week:'01'}];
 const actual=await inbox.readNotificationRows(async after=>({data:rows.filter(row=>!after||
  row.user_id>after.user_id||(row.user_id===after.user_id&&row.week>after.week)).slice(0,1),error:null}));
 assert.deepEqual(Array.from(actual),rows);
});
test('cursor reader propagates later page errors instead of returning partial data',async()=>{
 const failure=Error('page failed');
 await assert.rejects(inbox.readNotificationRows(async after=>after?{data:null,error:failure}:{data:[{id:1}],error:null}),e=>e===failure);
});
test('cursor reader rejects non-advancing pages and accepts an empty result',async()=>{
 await assert.rejects(inbox.readNotificationRows(async()=>({data:[{id:1}],error:null})),/did not advance/);
 assert.equal((await inbox.readNotificationRows(async()=>({data:null,error:null}))).length,0);
});
const uuid='03200000-0000-4000-8000-000000000001';
const payload={type:'morning_checkin',heading:'Daily check-in',content:'How are you?',link:'/',data:{destination_version:'1'}};
function delivery({enabled=true,fail=false,winner='morning_checkin',claim=null}={}){
 const calls=[];
 const admin={rpc:async(n,a)=>{calls.push(n);if(n==='ensure_notification_inbox_event')return fail?{error:Error('storage')}:
 {data:{id:uuid,user_id:uuid,type:winner,title:a.p_title,description:a.p_description,destination:a.p_destination}};
 return {data:n==='complete_notification_delivery'?true:claim};}};
 const api=load('src/lib/notifications/delivery.ts',{'./inbox':inbox,'@/lib/notifications/onesignal':{sendOneSignalToExternalUserId:async()=>{calls.push('provider');return {id:uuid};}}},
 {ITEM03_EXACT_PUSH_ENABLED:String(enabled)});
 return {calls,run:()=>api.sendRateLimitedNotification({admin,userId:uuid,type:payload.type,eventKey:'daily:2026-11-16',timezone:'Europe/London',payload})};
}
test('inbox persistence precedes rollout and push policy, including disabled push',async()=>{
 for(const enabled of [false,true]){const h=delivery({enabled});assert.equal(await h.run(),'limited');assert.equal(h.calls[0],'ensure_notification_inbox_event');assert.ok(!h.calls.includes('provider'));}
});
test('failed persistence prevents provider and claims; retry can succeed',async()=>{
 const failed=delivery({fail:true});await assert.rejects(failed.run());assert.deepEqual(failed.calls,['ensure_notification_inbox_event']);
 const h=delivery({claim:uuid});assert.equal(await h.run(),'sent');assert.deepEqual(h.calls,['ensure_notification_inbox_event','claim_item03_notification','claim_item03_notification','provider','complete_notification_delivery']);
});
test('different persisted daily winner prevents mismatched push',async()=>{
 const h=delivery({winner:'lowest_pillar',claim:uuid});assert.equal(await h.run(),'limited');assert.deepEqual(h.calls,['ensure_notification_inbox_event']);
});
test('saved title and destination are reused with inbox ID across retries',()=>{
 const result=inbox.savedInboxPayload({id:uuid,type:'weekly_score',title:'Saved title',description:'Saved description',destination:{version:'1',type:'weekly_score',link:'/progress',reporting_week:'2026-11-09'}});
 assert.equal(result.heading,'Saved title');assert.equal(result.data.reporting_week,'2026-11-09');assert.equal(result.data.inbox_event_id,uuid);
});
test('inbox API uses user JWT, strict inputs and private responses',async()=>{
 const calls=[];const api=load('src/app/api/notifications/inbox/route.ts',{
 'next/server':{NextResponse:{json:(body,options={})=>({body,...options})}},
 '@supabase/supabase-js':{createClient:(_u,_k,options)=>{calls.push(options);return {rpc:async(n,p)=>{calls.push([n,p]);return {data:{items:[],unreadCount:0}};}};}}
 });
 assert.equal((await api.GET(new Request('https://local/inbox'))).status,401);
 for(const query of ['?user_id='+uuid,'?count=2','?before_id='+uuid,'?limit=100','?id='+uuid+'&count=1']){
  assert.equal((await api.GET(new Request('https://local/inbox'+query,{headers:{authorization:'Bearer test'}}))).status,400);
 }
 const r=await api.GET(new Request('https://local/inbox',{headers:{authorization:'Bearer test'}}));
 assert.equal(r.body.state,'available');assert.equal(r.headers['Cache-Control'],'private, no-store');assert.equal(calls.at(-2).global.headers.Authorization,'Bearer test');
 assert.equal(calls.at(-1)[1].p_action,'list');assert.equal('p_user_id' in calls.at(-1)[1],false);
});
test('malformed source webhook inputs fail before database or persistence',async()=>{
 let databases=0;
 const api=load('src/app/api/notifications/events/route.ts',{'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},
 '@/lib/notifications/delivery':{},'@/utils/supabase/admin':{createAdminSupabaseClient:()=>{databases++;throw Error('not expected');}}},{NOTIFICATION_WEBHOOK_SECRET:'local'});
 for(const body of [{type:'unknown',record_id:uuid},{type:'community_reply',record_id:'bad'},{type:'community_like',record_id:uuid,target_type:'other',actor_user_id:uuid}]){
  assert.equal((await api.POST(new Request('https://local/events',{method:'POST',headers:{authorization:'Bearer local'},body:JSON.stringify(body)}))).status,400);
 }assert.equal(databases,0);
});
test('dispatcher discovers disabled optional schedules, every anniversary, and attempted sessions independently of push',async()=>{
 const attempts=[],persisted=[];
 const admin={rpc:async n=>({data:n==='notification_inbox_started_at'?'2026-11-01T00:00:00Z':n==='notification_inbox_retry_sources'?[]:
  {allowed:true,timezone:'Europe/London',date:'2026-11-16',observedAt:'2026-11-16T08:00:00Z'}}),from(table){
  const q={op:'read',after:false,gt(){q.after=true;return q;},or(){q.after=true;return q;},select(){return q;},update(){q.op='update';return q;},eq(){return q;},gte(){return q;},lte(){return q;},order(){return q;},limit(){return q;},
  maybeSingle:async()=>({data:{id:uuid,title:'Challenge'}}),then(resolve){
   const data=q.after?[]:table==='user_profile'?[{user_id:uuid}]:table==='notification_preferences'?
    [{user_id:uuid,notification_type:'bedtime_story',enabled:false,send_time:'08:30:00'},
     {user_id:uuid,notification_type:'workout_window',enabled:false,send_time:'08:00:00'},
     {user_id:uuid,notification_type:'journal_prompt',enabled:false,send_time:null}]:
    table==='milestones'?[{id:'one',text:'First'},{id:'two',text:'Second'}]:
    table==='present_dad_sessions'&&q.op==='read'?[{id:uuid,user_id:uuid,notification_attempted_at:'2026-11-16T07:00:00Z'}]:[];
   return Promise.resolve({data}).then(resolve);
  }};return q;
 }};
 const api=load('src/app/api/notifications/dispatch/route.ts',{
  '@/lib/notifications/inbox':{...inbox,persistInbox:async(_a,u,k)=>persisted.push([u,k])},'../events/route':{},
  '@/lib/reports/weekly-report-dispatch':{dispatchWeeklyReports:async()=>({})},'@/lib/notifications/item03-policy':{dispatchItem03Notifications:async()=>({})},
  'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},'@/utils/supabase/admin':{createAdminSupabaseClient:()=>admin},
  '@/lib/notifications/buildPayload':load('src/lib/notifications/buildPayload.ts'),
  '@/lib/notifications/delivery':{sendRateLimitedNotification:async a=>{attempts.push(a);return 'limited';}},
  '@/lib/notifications/time':{getLocalParts:()=>({localHHMM:'08:00'}),hhmmFromPgTime:v=>v.slice(0,5),isInWindow:(a,b)=>a===b,subtractMinutes:()=> '08:00'},
 },{CRON_SECRET:'local'});
 const response=await api.GET(new Request('https://local/dispatch',{headers:{authorization:'Bearer local'}}));assert.equal(response.body.ok,true);
 assert.deepEqual(attempts.map(a=>a.type),['bedtime_story','workout_window','weekly_challenge','milestone_anniversary','milestone_anniversary']);
 assert.notEqual(attempts.at(-1).eventKey,attempts.at(-2).eventKey);assert.equal(persisted.length,1,'attempt marker cannot hide missing session event');
 await api.GET(new Request('https://local/dispatch',{headers:{authorization:'Bearer local'}}));assert.equal(persisted.length,2,'source remains discoverable on later job');
});

// Opt in only to the existing network-isolated local container. Never production.
const sql=process.env.ITEM03_INBOX_SQL==='1';
const container='dadhealth-item03-audit',database=process.env.ITEM03_INBOX_TEST_DATABASE || 'item03_review_updated';
const command=['exec','-i','-e','PGPASSWORD=local-item03-only',container,'psql','-U','supabase_admin','-d',database,'-Atq','-v','ON_ERROR_STOP=1'];
function db(query){const r=spawnSync('docker',command,{input:query,encoding:'utf8',timeout:20000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function connection(name){
 const child=spawn('docker',command);let buffer='',pending,errors='';
 child.stdout.on('data',b=>{buffer+=b; if(pending&&buffer.includes(pending.marker)){const p=pending;pending=null;const i=buffer.indexOf(p.marker);const value=buffer.slice(0,i).trim();buffer=buffer.slice(i+p.marker.length);p.resolve(value);}});
 child.stderr.on('data',b=>errors+=b);child.on('error',e=>pending?.reject(e));child.on('close',c=>pending?.reject(Error(`${c}: ${errors}`)));
 return {send(query){assert.equal(pending==null,true);const marker='done_'+name+'_'+Math.random().toString(36).slice(2);
  const promise=new Promise((resolve,reject)=>{pending={marker,resolve,reject};});child.stdin.write(query+`\nselect '${marker}';\n`);return promise;},close(){child.stdin.end('rollback;\n\\q\n');}};
}
test('SQL: actual migration behavioural assertions',{skip:!sql},()=>{
 const inspect=spawnSync('docker',['inspect',container,'--format','{{.HostConfig.NetworkMode}}'],{encoding:'utf8'});assert.equal(inspect.stdout.trim(),'none');
 const result=db(readFileSync(new URL('../supabase/tests/notification_inbox_test.sql',import.meta.url),'utf8'));
 assert.doesNotMatch(result,/not ok/);assert.match(result,/1\.\.33/);
});
test('SQL: creation and mark-all really contend; post-cutoff entry stays unread; retries and rollback',{skip:!sql,timeout:45000},async()=>{
 const owner='03200000-0000-4000-8000-000000000009';
 db(`insert into auth.users(id,email) values('${owner}','inbox-race@example.invalid');`);
 const holder=connection('holder'),writer=connection('writer');
 const create=`set request.jwt.claim.role='service_role'; select public.ensure_notification_inbox_event('${owner}','journal_prompt','race','Journal','Reflect','{"version":"1","type":"journal_prompt","link":"/mind"}')->>'id';`;
 try{
  await holder.send(`begin;select pg_advisory_xact_lock(hashtextextended('${owner}',0));set request.jwt.claim.sub='${owner}';select public.notification_inbox('read_all');`);
  const waiting=writer.send("set application_name='inbox_creation_waiter';"+create);
  let blocked=false;
  for(let i=0;i<40;i++){if(db("select exists(select 1 from pg_stat_activity where application_name='inbox_creation_waiter' and wait_event='advisory');")==='t'){blocked=true;break;}await new Promise(r=>setTimeout(r,50));}
  assert.equal(blocked,true,'observed real advisory lock wait');
  await holder.send('commit;');const id=await waiting;assert.match(id,/^[0-9a-f-]{36}$/);
  assert.equal(db(`select count(*) from notification_inbox_events where user_id='${owner}' and read_at is null;`),'1');
  assert.equal(await writer.send(create),id);
  assert.equal(db(`select count(*) from notification_inbox_events where user_id='${owner}';`),'1');
  await writer.send('begin;'+create.replace("'race'","'rollback'")+'rollback;');
  assert.equal(db(`select count(*) from notification_inbox_events where user_id='${owner}';`),'1');
  assert.match(await writer.send(create.replace("'race'","'rollback'")),/^[0-9a-f-]{36}$/);
 }finally{holder.close();writer.close();db(`delete from auth.users where id='${owner}';`);}
});
