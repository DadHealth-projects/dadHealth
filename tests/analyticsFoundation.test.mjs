import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(path,mocks={}) { const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:id=>id in mocks?mocks[id]:require(id),process,Buffer,Date,Response,Request,AbortSignal,fetch,console});return exports; }
const contract=load('src/lib/analytics/contract.ts');
const api=load('src/lib/analytics/service.ts',{'./contract':contract});
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',consent='33333333-3333-4333-8333-333333333333';
const event=()=>({version:1,id,event:'app_opened',timestamp:new Date().toISOString(),properties:{}});
const body=()=>({action:'capture',owner,consent,secret:id+consent,event:event()});
test('invalid properties and fabricated billing facts never reach RPC',async()=>{
 const admin={rpc:()=>{throw Error('must not run');}};
 for(const e of [{...event(),properties:{email:'private'}},{...event(),event:'trial_started'},{...event(),owner:'other'}])await assert.rejects(api.ingest(admin,{...body(),event:e},owner),e=>e.status===400);
});
test('verified owner mismatch and anonymous assertion are rejected',async()=>{
 await assert.rejects(api.ingest({},body(),null),e=>e.status===403);
 await assert.rejects(api.ingest({},body(),id),e=>e.status===403);
});
test('durable receipt uses verified identity and hashed capability, duplicates return same event',async()=>{
 const calls=[];const admin={rpc:async(name,args)=>{calls.push([name,args]);return {data:'accepted'};}};
 const b=body();assert.equal((await api.ingest(admin,b,owner)).accepted,id);await api.ingest(admin,b,owner);
 assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0][1].p_owner,owner);assert.equal(calls[0][1].p_hash.length,64);assert.notEqual(calls[0][1].p_hash,b.secret);
});
test('withdrawal capability cannot create events or return data',async()=>{
 let args;const response=await api.ingest({rpc:async(_n,a)=>{args=a;return {data:'withdrawn'};}},{...body(),action:'withdraw'},null);
 assert.equal(response.withdrawn,true);assert.equal(args.p_event,null);assert.equal(args.p_withdraw,true);
});
test('payload streaming enforces 8KB even without Content-Length',async()=>{
 await assert.rejects(api.limitedBody(new Request('https://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(8193)})),e=>e.status===400);
});
test('worker authentication rejects missing, wrong and differently sized credentials',()=>{
 assert.equal(api.workerAuthorized(null,'abc'),false);assert.equal(api.workerAuthorized('Bearer a','abc'),false);assert.equal(api.workerAuthorized('Bearer abd','abc'),false);assert.equal(api.workerAuthorized('Bearer abc','abc'),true);
});
test('provider retries preserve dedupe tuple and original timestamp',async()=>{
 process.env.ANALYTICS_POSTHOG_CAPTURE_HOST='https://eu.i.posthog.com';process.env.ANALYTICS_POSTHOG_TOKEN='fixture';
 const item={id,lease:id,lease_until:new Date(Date.now()+60000).toISOString(),consent_id:consent,distinct_id:owner,event:'app_opened',occurred_at:new Date(Date.now()-10000).toISOString(),created_at:new Date().toISOString(),properties:{},attempts:1};
 const requests=[];const transport=async(_u,init)=>{requests.push(init);return Response.json({results:{[id]:{result:'ok'}}});};
 assert.equal(await api.deliver(item,transport),'sent');assert.equal(await api.deliver({...item,attempts:2},transport),'sent');
 assert.equal(requests[0].body,requests[1].body);assert.equal(requests[0].headers['PostHog-Request-Id'],requests[1].headers['PostHog-Request-Id']);
 assert.equal(JSON.parse(requests[0].body).batch[0].options.disable_skew_correction,true);
 assert.equal(await api.deliver(item,async()=>new Response('',{status:503})),'retry');
 assert.equal(await api.deliver(item,async()=>Response.json({results:{[id]:{result:'drop'}}})),'failed');
});
test('worker stays paused without remote retention approval but still cleans local retention',async()=>{
 delete process.env.ANALYTICS_REMOTE_RETENTION_APPROVED;process.env.ANALYTICS_DELIVERY_ENABLED='true';const calls=[];
 const result=await api.runAnalyticsWorker({rpc:async n=>{calls.push(n);return {};}});assert.equal(result.paused,true);assert.deepEqual(calls,['cleanup_optional_analytics','recover_analytics_actions']);
});
test('remote cleanup requires provider completion and zero remaining events',async()=>{
 const {erasePosthogOwner}=load('src/lib/analytics/privacy.ts',{'./service':api,'./contract':contract});
 process.env.ANALYTICS_POSTHOG_API_HOST='https://eu.posthog.com';process.env.POSTHOG_PROJECT_ID='1';process.env.POSTHOG_API_KEY='fixture';
 const p={};let saved=0,complete=false;const paths=[];
 const transport=async(url,init)=>{paths.push(url);return Response.json(url.includes('/deletion_status/')?{results:[{status:complete?'completed':'pending',delete_verified_at:complete?new Date().toISOString():null}]}:url.includes('/persons/?')?{results:[{uuid:id}]}:url.includes('/query/')?{results:[[0]]}:{persons_queued_for_deletion:1});};
 assert.equal(await erasePosthogOwner(owner,p,async()=>saved++,transport),false);assert.equal(saved,2);
 assert.equal(await erasePosthogOwner(owner,p,async()=>saved++,transport),false);complete=true;
 assert.equal(await erasePosthogOwner(owner,p,async()=>saved++,transport),true);assert.equal(paths.filter(v=>v.includes('bulk_delete')).length,1);
});

test('ingestion route authenticates the asserted owner and fails closed when disabled',async()=>{
 process.env.ANALYTICS_INGEST_ENABLED='true';process.env.ANALYTICS_PRIVACY_ENABLED='true';
 let token,verified;
 const admin={auth:{getUser:async t=>{token=t;return {data:{user:{id:owner}}};}}};
 const route=load('src/app/api/analytics/events/route.ts',{
  '@/utils/supabase/admin':{createAdminSupabaseClient:()=>admin},
  '@/utils/supabase/server':{createServerSupabaseClient:()=>{throw Error('no cookies for native');}},
  '@/lib/analytics/service':{...api,rateLimit:async()=>{},ingest:async(_a,b,o)=>{verified=o;return api.ingest({rpc:async()=>({data:'accepted'})},b,o);}},
 });
 const req=(payload,bearer='fixture-token')=>new Request('https://fixture.invalid/api/analytics/events',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${bearer}`},body:JSON.stringify(payload)});
 assert.equal((await route.POST(req(body()))).status,200);assert.equal(token,'fixture-token');assert.equal(verified,owner);
 assert.equal((await route.POST(req({...body(),owner:id}))).status,403);
 process.env.ANALYTICS_INGEST_ENABLED='false';assert.equal((await route.POST(req(body()))).status,503);
});

test('worker rechecks revoked claims without making a provider call',async()=>{
 process.env.ANALYTICS_REMOTE_RETENTION_APPROVED='true';process.env.ANALYTICS_DELIVERY_ENABLED='true';process.env.ANALYTICS_PRIVACY_ENABLED='true';
 let claims=0,sends=0;
 const result=await api.runAnalyticsWorker({rpc:async name=>name==='claim_optional_analytics'?{data:claims++===0?[{id,lease:id}]:[]}:name==='authorize_optional_analytics'?{data:false}:{}},async()=>{sends++;throw Error('must not send');});
 assert.equal(result.sent,0);assert.equal(sends,0);
 delete process.env.ANALYTICS_REMOTE_RETENTION_APPROVED;
});

test('worker route rejects unauthorized invocation before accessing database',async()=>{
 process.env.ANALYTICS_WORKER_SECRET='fixture-worker';let calls=0;
 const route=load('src/app/api/analytics/process/route.ts',{'@/utils/supabase/admin':{createAdminSupabaseClient:()=>{calls++;return {};}},'@/lib/analytics/service':{...api,runAnalyticsWorker:async()=>({paused:true,sent:0})}});
 assert.equal((await route.POST(new Request('https://fixture.invalid',{method:'POST'}))).status,401);assert.equal(calls,0);
 const result=await route.POST(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer fixture-worker'}}));assert.equal(result.status,200);assert.equal(calls,1);assert.equal(result.headers.get('cache-control'),'private, no-store');
});

test('malformed remote count cannot be mistaken for successful erasure',async()=>{
 const {erasePosthogOwner}=load('src/lib/analytics/privacy.ts',{'./service':api,'./contract':contract});
 await assert.rejects(erasePosthogOwner(owner,{analyticsPersons:[],analyticsDeletionRequested:true},async()=>{},async()=>Response.json({results:[[null]]})),e=>e.code==='posthog_cleanup_invalid');
});

test('web requires explicit grant, renews known capability and never creates account consent on login',async()=>{
 const rows=new Map(),calls=[],listeners={};const exports={};let storageFailed=false;
 const window={localStorage:{getItem:k=>rows.get(k)??null,setItem:(k,v)=>{if(storageFailed)throw Error('storage');rows.set(k,v);},removeItem:k=>rows.delete(k)},location:{hostname:'fixture.invalid'},addEventListener:(name,fn)=>listeners[name]=fn};
 vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/analytics.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{
 exports,require:()=>contract,window,document:{cookie:''},process:{env:{NEXT_PUBLIC_ANALYTICS_ENABLED:'true'}},crypto:require('node:crypto'),AbortController,AbortSignal,setTimeout,clearTimeout,
 fetch:async(_url,init)=>{calls.push(init);const b=JSON.parse(init.body);return Response.json(b.action==='grant'||b.action==='renew'?{owner:b.owner,consent,secret:id+consent,expiresAt:new Date(Date.now()+30*86400000).toISOString()}:b.action==='withdraw'?{withdrawn:true}:{});},
 });
 const tick=()=>new Promise(r=>setImmediate(r));const captures=()=>calls.filter(c=>JSON.parse(c.body).action==='capture');
 exports.initAnalytics();await tick();assert.equal(calls.length,0);
 rows.set(exports.ANALYTICS_CONSENT_KEY,'granted');exports.initAnalytics(true);await tick();
 assert.equal(JSON.parse(captures()[0].body).event.event,'$pageview');assert.equal(JSON.parse(captures()[0].body).owner,null);
 exports.initAnalytics();await tick();assert.equal(captures().length,1);
 exports.identifyAnalyticsUser(owner,{email:'must-not-send'});await tick();exports.trackEvent('app_opened');assert.equal(captures().length,1,'login cannot grant consent');
 exports.initAnalytics(true);await tick();exports.trackEvent('app_opened');assert.equal(captures().length,2);
 assert.equal(JSON.parse(captures()[1].body).owner,owner);assert.ok(!captures()[1].body.includes('must-not-send'));
 exports.identifyAnalyticsUser(id);await tick();exports.trackEvent('app_opened');assert.equal(captures().length,2);
 storageFailed=true;exports.withdrawAnalyticsConsent();await tick();exports.trackEvent('app_opened');assert.equal(captures().length,2);
 assert.ok(calls.some(c=>JSON.parse(c.body).action==='withdraw'));
 storageFailed=false;listeners.online();await tick();assert.equal(captures().length,2);
});

test('deletion waits for local leases and remote erasure; exhausted pending cleanup cannot claim success',async()=>{
 process.env.ANALYTICS_PRIVACY_ENABLED='true';
 let drained=false,remoteDone=false,remoteCalls=0;const patches=[];
 class PrivacyError extends Error {constructor(code){super(code);this.code=code;}}
 const deletion=load('src/lib/privacy/deletion.ts',{
  './auth':{PrivacyError},'./operations':{checkpoint:async(_a,_o,p)=>patches.push(p)},
  './external-cleanup':{openCleanup:JSON.parse},
  '@/lib/analytics/privacy':{erasePosthogOwner:async()=>{remoteCalls++;return remoteDone;}},
 });
 const op={user_id:owner,attempts:1,account_removed_at:'fixture',checkpoint:{external:'{}',storage:true,onesignal:true}};
 const admin={rpc:async(name)=>({data:name==='prepare_analytics_erasure'?(drained?'required':'draining'):null})};
 await deletion.processDeletion(admin,op);assert.equal(remoteCalls,0);assert.equal(patches.length,0);
 drained=true;await deletion.processDeletion(admin,op);assert.equal(remoteCalls,1);assert.equal(patches.length,0);
 await assert.rejects(deletion.processDeletion(admin,{...op,attempts:8}),e=>e.code==='analytics_cleanup_pending');
 assert.ok(!patches.some(p=>p.state==='completed'));
 remoteDone=true;await deletion.processDeletion(admin,op);assert.equal(patches.at(-1).state,'completed');assert.ok(patches.some(p=>p.checkpoint?.analytics===true));
});

test('remote erasure with missing credentials is a failure even when collection/delivery flags are disabled',async()=>{
 const {erasePosthogOwner}=load('src/lib/analytics/privacy.ts',{'./service':api,'./contract':contract});
 const saved=process.env.POSTHOG_API_KEY;delete process.env.POSTHOG_API_KEY;
 process.env.ANALYTICS_DELIVERY_ENABLED='false';process.env.ANALYTICS_PRIVACY_ENABLED='false';
 try {await assert.rejects(erasePosthogOwner(owner,{},async()=>{},async()=>{throw Error('no provider call');}),e=>e.code==='posthog_cleanup_configuration_required');}
 finally {if(saved)process.env.POSTHOG_API_KEY=saved;}
});

test('worker authorizes durable exposure before an uncertain provider request and records retry',async()=>{
 process.env.ANALYTICS_DELIVERY_ENABLED='true';process.env.ANALYTICS_PRIVACY_ENABLED='true';process.env.ANALYTICS_REMOTE_RETENTION_APPROVED='true';
 process.env.ANALYTICS_POSTHOG_CAPTURE_HOST='https://eu.i.posthog.com';process.env.ANALYTICS_POSTHOG_TOKEN='fixture';
 const stages=[];let claimed=false;const item={id,lease:id,lease_until:new Date(Date.now()+60000).toISOString(),consent_id:consent,distinct_id:owner,event:'app_opened',occurred_at:new Date().toISOString(),created_at:new Date().toISOString(),properties:{},attempts:1};
 const admin={rpc:async(name,args)=>{stages.push(name);if(name==='claim_optional_analytics'){const data=claimed?[]:[item];claimed=true;return {data};}if(name==='finish_optional_analytics'){assert.equal(args.p_result,'retry');return {data:true};}return {data:true};}};
 await api.runAnalyticsWorker(admin,async()=>{stages.push('provider');throw Error('lost response');});
 assert.ok(stages.indexOf('authorize_optional_analytics')<stages.indexOf('provider'));
 assert.ok(stages.indexOf('finish_optional_analytics')>stages.indexOf('provider'));
 delete process.env.ANALYTICS_REMOTE_RETENTION_APPROVED;
});
