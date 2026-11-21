import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync('src/app/api/dad_days_searches/route.ts','utf8');
const input={budget:'free',childAge:'primary',latitude:51,longitude:0,radius:20};
const result={name:'Park',description:'Walk',address:'Address',distanceMiles:1,estimatedCost:'Free',ageRange:'All',websiteUrl:'https://example.org',requiresBooking:false};
function setup(options={}) {
 const logs=[],inserts=[],exports={};let reads=0,calls=0;
 const admin={auth:{getUser:async()=>({data:{user:options.anonymous?null:{id:'owner'}}})},from:()=>({
 select(){return this},eq(){return this},gte:async()=>({count:++reads===1?options.hourly??0:options.used??0,error:options.countError?{code:'private',message:'PRIVATE'}:null}),
 insert:async row=>{inserts.push(row);return {error:options.saveError?{}:null};}
 })};
 class Anthropic {messages={create:async()=>{calls++;if(options.providerError)throw options.providerError;return {content:[{type:'text',text:options.text??JSON.stringify([result])}]};}}}
 const mocks={'node:crypto':{randomUUID:()=> 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'},'next/server':{NextResponse:{json:(body,init)=>({body,...init})}},'@anthropic-ai/sdk':{default:Anthropic},
 '@/lib/native-subscriptions/store':{getSubscriptionSummary:async()=>{if(options.subscriptionError)throw Error('PRIVATE');return {isPro:options.pro??false};}},
 '@/utils/supabase/admin':{createAdminSupabaseClient:()=>admin},'@/utils/supabase/server':{createServerSupabaseClient:async()=>({auth:admin.auth})},'@/lib/familyAges':{youngestChildBand:()=>null}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>mocks[n],process:{env:{NEXT_PUBLIC_SUPABASE_URL:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture',ANTHROPIC_API_KEY:options.missingKey?undefined:'fixture'}},console:{info:(_tag,data)=>logs.push(data)}});
 return {logs,inserts,calls:()=>calls,post:body=>exports.POST({headers:new Headers({Authorization:'Bearer fixture'}),json:async()=>body})};
}
test('successful search validates provider records and saves verified owner, not supplied owner',async()=>{const h=setup();const r=await h.post({...input,userId:'other'});assert.equal(r.status,200);assert.equal(r.body.results[0].name,'Park');assert.equal(h.inserts[0].user_id,'owner');assert.match(r.headers['X-Dad-Days-Request-ID'],/^[a-f0-9-]{36}$/);});
test('invalid/missing age or budget rejects without provider or usage write',async()=>{for(const body of [{...input,childAge:undefined},{...input,childAge:'adult'},{...input,budget:'cheap'},null,{...input,radius:-1}]){const h=setup(),r=await h.post(body);assert.equal(r.status,400);assert.equal(h.calls(),0);assert.equal(h.inserts.length,0);}});
test('expired session, allowance failures and verified limits are distinct',async()=>{for(const [options,status,code] of [[{anonymous:true},401,'session_expired'],[{used:3},403,'search_limit_reached'],[{hourly:10},429,'rate_limit_exceeded'],[{countError:true},503,'allowance_unavailable'],[{subscriptionError:true},503,'allowance_unavailable']]){const h=setup(options),r=await h.post(input);assert.equal(r.status,status);assert.equal(r.body.error,code);assert.equal(h.calls(),0);}});
test('silent provider failures now produce safe correlated stages; no raw private error is logged',async()=>{for(const [options,code] of [[{missingKey:true},'provider_configuration'],[{providerError:{status:401,message:'PRIVATE'}},'provider_configuration'],[{providerError:{status:429,message:'PRIVATE'}},'provider_busy'],[{providerError:Error('PRIVATE')},'provider_failed'],[{text:'PRIVATE not JSON'},'provider_response_invalid'],[{text:'{}'},'provider_response_invalid'],[{saveError:true},'usage_save_failed']]){const h=setup(options),r=await h.post(input);assert.equal(r.body.error,code);assert.equal(h.logs[0].code,code);assert.equal(h.logs[0].requestId,r.headers['X-Dad-Days-Request-ID']);assert.ok(!JSON.stringify(h.logs).includes('PRIVATE'));}});
test('empty array is valid; failed provider request can be retried without consuming allowance',async()=>{const h=setup({text:'[]'});assert.equal((await h.post(input)).status,200);const failed=setup({text:'broken'});assert.equal((await failed.post(input)).status,502);assert.equal(failed.inserts.length,0);assert.equal((await setup().post(input)).status,200);});
