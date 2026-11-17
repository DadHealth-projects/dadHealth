import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, mocks = {}, env = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url),'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, process:{env}, console:{info(){},warn(){}}, require:name=>{if(name==='./inbox' && !(name in mocks))return load('src/lib/notifications/inbox.ts');assert.ok(name in mocks,name);return mocks[name];} });
  return exports;
}
function accounts(rows) {
  return {from:()=>{let after=null;const q={select:()=>q,order:()=>q,limit:()=>q,
    gt:(_key,value)=>{after=value;return q;},
    then:resolve=>Promise.resolve({data:rows.filter(r=>after===null||r.user_id>after),error:null}).then(resolve)};return q;}};
}
test('rollout disabled still discovers eligible accounts for inbox creation',async()=>{
  let delivered=0;
  const api=load('src/lib/notifications/item03-policy.ts',{'./delivery':{sendRateLimitedNotification:async()=>{delivered++;return 'limited';}}});
  assert.equal(api.exactPushEnabled(),false);
  const admin={...accounts([{user_id:'a'}]),rpc:async()=>({data:{allowed:true,date:'2026-11-16',dailyType:'morning_checkin',trials:[]}})};
  assert.equal((await api.dispatchItem03Notifications(admin)).sent,0);assert.equal(delivered,1);
});

test('pillar destinations are fixed, validated and Body uses approved free workout',()=>{
  const api=load('src/lib/notifications/item03-policy.ts',{'./delivery':{}});
  for(const p of ['mind','body','bond']) assert.equal(api.pillarPayload(p).data.pillar,p);
  assert.equal(api.pillarPayload('body').data.workout_id,'89e97b6c-0bfa-407d-a9f4-5020b086ba11');
  assert.equal(api.pillarPayload('unknown'),null);
});
test('all daily attempts precede trial attempts with stable episode identities',async()=>{
  const sent=[];
  const api=load('src/lib/notifications/item03-policy.ts',{'./delivery':{sendRateLimitedNotification:async a=>{sent.push(a);return 'sent';}}},{ITEM03_EXACT_PUSH_ENABLED:'true'});
  const admin={...accounts([{user_id:'a'},{user_id:'b'}]),
    rpc:async()=>({data:{allowed:true,timezone:'Europe/London',date:'2026-11-16',dailyType:'morning_checkin',trials:['episode']}})};
  assert.equal((await api.dispatchItem03Notifications(admin)).sent,4);
  assert.deepEqual(sent.map(a=>a.type),['morning_checkin','morning_checkin','trial_ending','trial_ending']);
  assert.equal(sent[0].eventKey,'daily:2026-11-16');assert.equal(sent[2].eventKey,'trial:episode');
});
function deliveryHarness(results) {
  const calls=[];
  const api=load('src/lib/notifications/delivery.ts',{
    './inbox':{persistInbox:async(_a,_u,_k,p)=>({type:p.type}),savedInboxPayload:e=>({type:e.type,data:{}})},
    '@/lib/notifications/onesignal':{sendOneSignalToExternalUserId:async args=>{calls.push(['provider',args]);return {id:'provider-id'};}},
  },{ITEM03_EXACT_PUSH_ENABLED:'true'});
  const admin={rpc:async(name,args)=>{calls.push([name,args]);return results.shift();}};
  return {calls,run:()=>api.sendRateLimitedNotification({admin,userId:'owner',type:'morning_checkin',timezone:'Europe/London',eventKey:'daily:2026-11-16',payload:{type:'morning_checkin'}})};
}
test('changed consent/completion before send leaves claim unsent',async()=>{
  const h=deliveryHarness([{data:'claim'},{data:null}]);assert.equal(await h.run(),'limited');assert.equal(h.calls.length,2);
});
test('provider uses reservation id and completes only after provider acceptance',async()=>{
  const h=deliveryHarness([{data:'claim'},{data:'claim'},{data:true}]);assert.equal(await h.run(),'sent');
  assert.deepEqual(h.calls.map(c=>c[0]),['claim_item03_notification','claim_item03_notification','provider','complete_notification_delivery']);
  assert.equal(h.calls[2][1].idempotencyKey,'claim');
});
test('claim errors never send and completion errors are not reported as sent',async()=>{
  const first=deliveryHarness([{error:Error('database')}]);await assert.rejects(first.run());assert.equal(first.calls.length,1);
  const last=deliveryHarness([{data:'claim'},{data:'claim'},{error:Error('completion')}]);await assert.rejects(last.run());
});
