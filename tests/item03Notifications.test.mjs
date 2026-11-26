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
function withTrialEnds(base, ends) {
  // notification_trial_episodes stub: verified end per episode, owner-filtered like the real query.
  const profiles=base.from;
  return {from:table=>{if(table!=='notification_trial_episodes')return profiles(table);
    let owner=null,ids=[];const q={select:()=>q,eq:(_k,v)=>{owner=v;return q;},in:(_k,v)=>{ids=v;return q;},
      then:resolve=>Promise.resolve({data:ids.filter(id=>id in ends&&owner).map(id=>({id,ends_at:ends[id]})),error:null}).then(resolve)};return q;}};
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
  const admin={...withTrialEnds(accounts([{user_id:'a'},{user_id:'b'}]),{episode:new Date(Date.now()+48*36e5).toISOString()}),
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

test('trial reminder wording is only sent while "ends in 2 days" is true for the verified end',()=>{
  const api=load('src/lib/notifications/item03-policy.ts',{'./delivery':{}});
  const now=Date.parse('2026-11-26T09:00:00Z'), at=h=>new Date(now+h*36e5).toISOString();
  assert.equal(api.trialReminderDue(at(48),now),true,'two days left');
  assert.equal(api.trialReminderDue(at(36),now),true);assert.equal(api.trialReminderDue(at(59.9),now),true);
  assert.equal(api.trialReminderDue(at(60),now),false,'2.5 days rounds to 3: not "2 days"');
  assert.equal(api.trialReminderDue(at(72),now),false,'start of the eligible window: 3 days left');
  assert.equal(api.trialReminderDue(at(35.9),now),false,'delayed: under 36 h left is never "2 days"');
  assert.equal(api.trialReminderDue(at(6),now),false,'late rollout / retry hours before the end');
  assert.equal(api.trialReminderDue(at(-1),now),false,'expired');
  for(const bad of [null,undefined,'',  'not-a-date',123]) assert.equal(api.trialReminderDue(bad,now),false,'unknown end never sends');
});

test('across the whole eligible window of a 7-day trial, every send says "2 days" truthfully and a send window exists',()=>{
  const api=load('src/lib/notifications/item03-policy.ts',{'./delivery':{}});
  for (const startMinute of [0, 7*60+13, 23*60+59]) {
    const start=Date.parse('2026-11-20T00:00:00Z')+startMinute*6e4, end=start+168*36e5;
    let sends=0;
    // Database eligibility: from 96 h after start until the end. Dispatcher runs every 15 minutes.
    for (let t=start+96*36e5; t<end; t+=15*6e4) {
      if (!api.trialReminderDue(new Date(end).toISOString(), t)) continue;
      sends++;
      assert.equal(Math.round((end-t)/864e5), 2, 'remaining time rounds to exactly two days at every possible send');
    }
    assert.ok(sends>0, 'there is always a dispatcher run inside the send window');
  }
});

test('delayed, expired and unknown trials send nothing; on-time sends once per episode key',async()=>{
  const sent=[];
  const api=load('src/lib/notifications/item03-policy.ts',{'./delivery':{sendRateLimitedNotification:async a=>{sent.push(a);return 'sent';}}},{ITEM03_EXACT_PUSH_ENABLED:'true'});
  const h=x=>new Date(Date.now()+x*36e5).toISOString();
  const admin={...withTrialEnds(accounts([{user_id:'a'}]),{ontime:h(48),late:h(10),expired:h(-2)}),
    rpc:async()=>({data:{allowed:true,timezone:'Europe/London',date:'2026-11-26',dailyType:null,trials:['ontime','late','expired','missing','ontime']}})};
  await api.dispatchItem03Notifications(admin);
  assert.deepEqual(sent.map(a=>a.eventKey),['trial:ontime','trial:ontime'],'only the on-time episode; a repeated id reuses the same idempotent claim key');
  assert.equal(sent[0].payload.heading,'Your trial ends in 2 days');
});

test('the end time is read per account, owner-scoped, just before sending',()=>{
  const src=readFileSync(new URL('../src/lib/notifications/item03-policy.ts',import.meta.url),'utf8');
  assert.match(src,/from\('notification_trial_episodes'\)\.select\('id,ends_at'\)\.eq\('user_id', userId\)\.in\('id', ids\)/);
  assert.match(src,/for \(const episode of trials\) \{\s*if \(!trialReminderDue\(endsAt\?\.get\(episode\)\)\) continue;/);
});
