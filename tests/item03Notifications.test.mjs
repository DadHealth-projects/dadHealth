import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, mocks = {}, env = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url),'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, process:{env}, console:{info(){},warn(){}}, require:name=>{assert.ok(name in mocks,name);return mocks[name];} });
  return exports;
}
test('rollout gate defaults disabled without querying accounts or sending',async()=>{
  const api=load('src/lib/notifications/item03-policy.ts',{'./delivery':{}});
  assert.equal(api.exactPushEnabled(),false);
  assert.equal((await api.dispatchItem03Notifications({})).sent,0);
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
  const admin={from:()=>({select:()=>({eq:async()=>({data:[{user_id:'a'},{user_id:'b'}]})})}),
    rpc:async()=>({data:{allowed:true,timezone:'Europe/London',date:'2026-11-16',dailyType:'morning_checkin',trials:['episode']}})};
  assert.equal((await api.dispatchItem03Notifications(admin)).sent,4);
  assert.deepEqual(sent.map(a=>a.type),['morning_checkin','morning_checkin','trial_ending','trial_ending']);
  assert.equal(sent[0].eventKey,'daily:2026-11-16');assert.equal(sent[2].eventKey,'trial:episode');
});
function deliveryHarness(results) {
  const calls=[];
  const api=load('src/lib/notifications/delivery.ts',{
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
