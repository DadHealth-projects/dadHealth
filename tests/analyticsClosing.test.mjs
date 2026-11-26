import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path, mocks = {}, extra = {}) {
 const exports = {};
 vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,require:id=>id in mocks?mocks[id]:require(id),process,Buffer,Date,URL,Response,Request,AbortSignal,fetch,TextDecoder,console,...extra});return exports;
}
const contract=load('src/lib/analytics/contract.ts');
const service=load('src/lib/analytics/service.ts',{'./contract':contract});
const billing=load('src/lib/analytics/billing.ts',{'./contract':contract});
const choice=load('src/lib/analytics/billing-consent.ts',{'./service':service,'./contract':contract});
const erasure=load('src/lib/analytics/privacy.ts',{'./service':service,'./contract':contract});
class PrivacyError extends Error {constructor(code){super(code);this.code=code;}}
const reader=load('src/lib/privacy/posthog-export-reader.ts',{'./auth':{PrivacyError}});
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const id=n=>`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`;
function config(){Object.assign(process.env,{ANALYTICS_POSTHOG_API_HOST:'https://eu.posthog.com',POSTHOG_PROJECT_ID:'162656',POSTHOG_API_KEY:'fixture',POSTHOG_OWNER_SQL_EXPORTS_VERIFIED:'true',POSTHOG_EXPORT_DOWNLOAD_HOSTS:'fixture-storage.invalid'});}
test('billing choice rejects ownership/private overrides and malformed server responses',async()=>{
 const calls=[];const admin={rpc:async(n,a)=>{calls.push([n,a]);return {data:{owner,granted:false,revision:0,operationId:null,grantedAt:null}};}};
 await choice.billingConsentChoice(admin,owner);assert.equal(calls[0][1].p_owner,owner);
 for(const body of [{owner:other,granted:true,revision:0,operationId:id(1)},{granted:true,revision:-1,operationId:id(1)},{granted:'true',revision:0,operationId:id(1)}])
  await assert.rejects(choice.billingConsentChoice(admin,owner,body),e=>e.code==='invalid_payload');
 assert.equal(calls.length,1);
 await assert.rejects(choice.billingConsentChoice({rpc:async()=>({data:{owner:other}})},owner),e=>e.code==='storage_unavailable');
 await assert.rejects(choice.billingConsentChoice({rpc:async()=>({error:{code:'40001'}})},owner),e=>e.status===409);
});
test('billing adapter uses only account consent RPC; device secrets never authorize and outages do not reject billing',async()=>{
 process.env.ANALYTICS_BILLING_COLLECTION_ENABLED='true';
 process.env.ANALYTICS_INGEST_ENABLED='true';process.env.ANALYTICS_PRIVACY_ENABLED='true';
 const at=new Date().toISOString(),calls=[];
 const input={userId:owner,provider:'apple',environment:'sandbox',providerSubscriptionId:'fixture',status:'trialing',lastVerifiedAt:at,
 trialFacts:{transactionId:'trial',startedAt:at,endsAt:new Date(Date.now()+86400000).toISOString()}};
 const admin={rpc:(n,a)=>{calls.push([n,a]);return {abortSignal:async()=>({data:false})};}};
 assert.equal((await billing.collectVerifiedBilling(admin,input,null,{owner,secretHash:'never-use'})).collected,0);
 assert.equal(calls[0][0],'record_account_billing_analytics');assert.equal('p_hash' in calls[0][1],false);assert.equal('p_consent' in calls[0][1],false);
 assert.equal((await billing.collectVerifiedBilling({rpc:()=>({abortSignal:async()=>{throw Error('fixture outage');}})},input,null,null)).collected,0);
 assert.equal((await billing.collectVerifiedBilling({rpc:()=>({abortSignal:async signal=>{assert.equal(signal.aborted,false);return {data:true};}})},input,null,null)).collected,1);
 delete process.env.ANALYTICS_BILLING_COLLECTION_ENABLED;
 assert.equal((await billing.collectVerifiedBilling(admin,input,null,null)).suppressed,true);
});
test('supported SQL export resumes provider run/files, keeps Unicode/nulls, sorts and never forwards API key to storage',async()=>{
 config();let state,created=0;const calls=[];
 const input={aliases:[owner,'legacy-alias'],cutoff:'2026-11-20T00:00:00.000Z',limit:101,pass:'events:0'};
 const transport=async(url,init)=>{
  calls.push([url,init]);
  if(url.endsWith('/file_download_batch_exports/')){
   created++;const b=JSON.parse(init.body);assert.equal(b.model,'hogql');assert.match(b.hogql_query,/distinct_id IN/);assert.match(b.hogql_query,/LIMIT 101$/);return Response.json({id:id(1)},{status:202});
  }
  if(url.endsWith(`/${id(1)}/`))return Response.json({status:'Completed',files:[id(2),id(3)]});
  if(url.includes('/download/'))return new Response(null,{status:302,headers:{location:`https://fixture-storage.invalid/${url.endsWith(id(2)+'/')?'2':'1'}`}});
  assert.equal(init.headers,undefined);assert.equal(init.redirect,'error');
  const n=Number(url.at(-1));return new Response(JSON.stringify({id:id(n+3),event:'app_opened',timestamp:input.cutoff,distinct_id:owner,properties:{text:'é 😀\nline',nullable:null}})+'\n');
 };
 const run=()=>reader.readPosthogExportPage(input,state,async next=>{state=structuredClone(next);},transport);
 for(let i=0;i<4;i++)assert.equal(await run(),null);
 const result=await run();assert.equal(created,1);assert.equal(result.results.length,2);assert.equal(result.results[0][0],id(4));assert.equal(result.results[0][4].nullable,null);
 assert.ok(calls.every(([url])=>!url.includes('/query/')));
});
test('missing capability, hostile storage URL, failed run and poisoned over-limit pages never become successful exports',async()=>{
 config();const input={aliases:[owner],cutoff:new Date().toISOString(),limit:101,pass:'events'};
 delete process.env.POSTHOG_OWNER_SQL_EXPORTS_VERIFIED;
 await assert.rejects(reader.readPosthogExportPage(input,undefined,async()=>{},async()=>{throw Error('no call');}),e=>e.code==='analytics_export_capability_required');
 config();let state;await reader.readPosthogExportPage(input,undefined,async s=>state=s,async()=>Response.json({id:id(1)}));
 await assert.rejects(reader.readPosthogExportPage(input,state,async()=>{},async()=>Response.json({status:'Failed'})),e=>e.code==='analytics_export_provider_unavailable');
 state={...state,files:[id(2)],rows:[],fileIndex:0};
 await assert.rejects(reader.readPosthogExportPage(input,state,async()=>{},async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})),e=>e.code==='analytics_export_download_host_required');
 const rows=Array.from({length:102},()=>JSON.stringify({id:id(4)})).join('\n');
 await assert.rejects(reader.readPosthogExportPage(input,state,async()=>{},async url=>url.includes('/download/')?new Response(null,{status:302,headers:{location:'https://fixture-storage.invalid/file'}}):new Response(rows)),e=>e.code==='analytics_export_invalid');
});
test('erasure discovers verified aliases across pages, survives restart and verifies all identities',async()=>{
 config();const p={},requests=[];let removed=false;
 const transport=async(url,init)=>{
  requests.push([url,init]);
  if(url.includes('bulk_delete')){assert.deepEqual(JSON.parse(init.body).distinct_ids,[owner,'legacy']);removed=true;return Response.json({});}
  if(url.includes('deletion_status'))return Response.json({results:[{status:'completed',delete_verified_at:new Date().toISOString()}]});
  if(url.includes('/query/')){assert.match(JSON.parse(init.body).query.query,/'legacy'/);return Response.json({results:[[0]]});}
  if(removed)return Response.json({results:[],next:null});
  return Response.json({results:[{uuid:url.includes('cursor=2')?id(2):id(1),distinct_ids:[owner,'legacy']}],next:url.includes('cursor=2')?null:`https://eu.posthog.com/api/projects/162656/persons/?distinct_id=${owner}&cursor=2`});
 };
 const safe=async aliases=>aliases.includes(owner)&&!aliases.includes(other);
 let turns=0;while(!await erasure.erasePosthogOwner(owner,p,async()=>{},transport,safe))assert.ok(++turns<8);
 assert.equal(p.analyticsPersons.length,2);assert.equal(requests.filter(([u])=>u.includes('bulk_delete')).length,1);
 const bad={};await assert.rejects(erasure.erasePosthogOwner(owner,bad,async()=>{},async()=>Response.json({results:[{uuid:id(1),distinct_ids:[owner,other]}]}),safe),e=>e.code==='posthog_cleanup_identity_unverified');
});
test('erasure checkpoints status pagination and rejects a foreign-person next page',async()=>{
 config();const person=id(4), p={analyticsDiscoveryComplete:true,analyticsAliases:[owner],analyticsPersons:[person],analyticsDeletionRequested:true};
 const next=`https://eu.posthog.com/api/projects/162656/persons/deletion_status/?person_uuid=${person}&status=all&cursor=2`;
 const completed={status:'completed',delete_verified_at:new Date().toISOString()};let saved=0;
 assert.equal(await erasure.erasePosthogOwner(owner,p,async()=>{saved++;},async()=>Response.json({results:[completed],next})),false);
 assert.equal(saved,1);assert.match(p.analyticsStatusCursor,/cursor=2/);assert.equal(p.analyticsStatusIndex,undefined);
 assert.equal(await erasure.erasePosthogOwner(owner,p,async()=>{},async url=>{assert.match(url,/cursor=2/);return Response.json({results:[completed],next:null});}),false);
 assert.equal(p.analyticsStatusIndex,1);assert.equal(p.analyticsStatusCursor,null);
 p.analyticsStatusIndex=0;
 await assert.rejects(erasure.erasePosthogOwner(owner,p,async()=>{},async()=>Response.json({results:[completed],next:next.replace(person,id(5))})),e=>e.code==='posthog_cleanup_invalid');
});
test('provider-only GeoIP disable cannot be overridden by event properties',async()=>{
 process.env.ANALYTICS_POSTHOG_CAPTURE_HOST='https://eu.i.posthog.com';process.env.ANALYTICS_POSTHOG_TOKEN='fixture';let sent;
 const item={id:id(1),event:'app_opened',properties:{},distinct_id:owner,occurred_at:new Date().toISOString(),created_at:new Date().toISOString(),lease_until:new Date(Date.now()+60000).toISOString(),attempts:1};
 assert.equal(await service.deliver(item,async(_u,init)=>{sent=JSON.parse(init.body);return Response.json({results:{[id(1)]:{result:'ok'}}});}),'sent');
 assert.equal(sent.batch[0].properties.$geoip_disable,true);assert.equal('$ip' in sent.batch[0].properties,false);
 assert.equal(await service.deliver({...item,properties:{$geoip_disable:false}},async()=>{throw Error('no call');}),'failed');
});

test('billing consent route authenticates owner and withdrawal remains available while collection is paused',async()=>{
 const calls=[];let acceptedOwner=owner;
 const admin={auth:{getUser:async()=>({data:{user:acceptedOwner?{id:acceptedOwner}:null}})},rpc:async(n,a)=>{
  calls.push([n,a]);return {data:n==='analytics_rate_limit'?true:{owner,granted:false,revision:2,operationId:id(1),grantedAt:null}};
 }};
 const route=load('src/app/api/analytics/billing-consent/route.ts',{'@/utils/supabase/admin':{createAdminSupabaseClient:()=>admin},
 '@/utils/supabase/server':{createServerSupabaseClient:async()=>{throw Error('no cookie fallback');}},'@/lib/analytics/service':service,'@/lib/analytics/billing-consent':choice});
 const request=body=>new Request('https://fixture.invalid/api/analytics/billing-consent',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(body)});
 delete process.env.ANALYTICS_BILLING_COLLECTION_ENABLED;
 const response=await route.POST(request({granted:false,revision:1,operationId:id(1)}));assert.equal(response.status,200);
 assert.match(response.headers.get('cache-control'),/no-store/);assert.ok(response.headers.get('x-analytics-request-id'));
 assert.equal(calls.at(-1)[1].p_owner,owner);
 assert.equal((await route.POST(request({owner:other,granted:true,revision:1,operationId:id(2)}))).status,400);
 acceptedOwner=null;assert.equal((await route.POST(request({granted:true,revision:1,operationId:id(2)}))).status,401);
});

test('large provider pages reduce keyset batch size rather than truncate or restart the whole export',async()=>{
 config();let state;const input={aliases:[owner],cutoff:new Date().toISOString(),limit:101,pass:'events'};
 await reader.readPosthogExportPage(input,undefined,async s=>state=s,async()=>Response.json({id:id(1)}));
 state={...state,files:[id(2)],fileIndex:0,rows:[]};
 const data=' '.repeat(17*1024*1024);
 const result=await reader.readPosthogExportPage(input,state,async s=>state=s,async url=>url.includes('/download/')?
  new Response(null,{status:302,headers:{location:'https://fixture-storage.invalid/file'}}):new Response(data));
 assert.equal(result,null);assert.equal(state.id,'');assert.equal(state.pageSize,50);
 await reader.readPosthogExportPage(input,state,async s=>state=s,async(_url,init)=>{assert.match(JSON.parse(init.body).hogql_query,/LIMIT 50$/);return Response.json({id:id(3)});});
 assert.equal(state.id,id(3));
});
