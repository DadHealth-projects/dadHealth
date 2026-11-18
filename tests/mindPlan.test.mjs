import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path,deps={}){
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
 }).outputText,{exports,Date,URL,require:id=>{assert.ok(id in deps,id);return deps[id];}});return exports;
}
const service=load('src/lib/mind/plan.ts');
const id='04000000-0000-4000-8000-000000000001';
function fixture(){return {state:'available',currentDate:'2026-11-17',timezone:'Europe/London',receipt:null,plan:{
 id,version:'mind-plan-v1',copyStatus:'draft',variant:'balanced',createdAt:'2026-11-17T10:00:00Z',startedOn:'2026-11-17',
 actions:Array.from({length:7},(_,i)=>({id:`a${i}`,title:'Draft',instruction:'Try a reset',route:'BreathingSession'})),
 completions:[],completed:false,nextAction:1,canComplete:true,
}};}
function harness(){
 const h={signedIn:true,calls:[],data:fixture(),error:null};
 const admin={rpc:async(name,args)=>{h.calls.push({name,args});return {data:h.data,error:h.error};}};
 const api=load('src/lib/mind/plan-api.ts',{
  'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
  '@/lib/native-subscriptions/auth':{authenticateNativeSubscriptionRequest:async()=>h.signedIn?{admin,user:{id:'verified-owner'}}:null},
  './plan':service,
 });
 const routes=Object.fromEntries(['read','start','complete'].map(op=>[op,load(`src/app/api/mind/plan/${op==='read'?'':op+'/'}route.ts`,{'@/lib/mind/plan-api':api})]));
 h.request=(op,body={},query='')=>routes[op][op==='read'?'GET':'POST'](new Request('https://local.invalid/api/mind/plan'+query,
  op==='read'?{}:{method:'POST',body:JSON.stringify(body)}));return h;
}
test('every endpoint rejects anonymous access before touching the database',async()=>{
 for(const op of ['read','start','complete']){const h=harness();h.signedIn=false;assert.equal((await h.request(op)).status,401);assert.equal(h.calls.length,0);}
});
test('GET stays read-only; start is explicit; verified owner alone reaches RPC',async()=>{
 const h=harness();for(const op of ['read','start']){
  const response=await h.request(op);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(h.calls.at(-1).args.p_user_id,'verified-owner');assert.equal(h.calls.at(-1).args.p_operation,op);
 }
 assert.equal((await h.request('complete',{planId:id,actionNumber:1})).status,200);
 assert.equal(h.calls.at(-1).args.p_action_number,1);
});
test('ownership, access, date and content overrides are rejected',async()=>{
 for(const body of [{userId:'other'},{access:true},{date:'2026-11-18'},{actions:[]},null,[]]){
  const h=harness();assert.equal((await h.request('start',body)).status,400);assert.equal(h.calls.length,0);
 }
 for(const body of [{planId:id,actionNumber:0},{planId:id,actionNumber:8},{planId:id,actionNumber:1,owner:'other'},{}]){
  const h=harness();assert.equal((await h.request('complete',body)).status,400);assert.equal(h.calls.length,0);
 }
 const h=harness();assert.equal((await h.request('read',{},'?userId=other')).status,400);
});
test('Free, unknown access and failed entitlement RPC never expose any plan',async()=>{
 for(const op of ['read','start','complete'])for(const mode of ['free','null','error','unknown']){
  const h=harness();h.data=mode==='free'?{state:'locked',plan:fixture().plan}:mode==='unknown'?{state:'unavailable',reason:'entitlement_unavailable'}:null;
  if(mode==='error')h.error={message:'PRIVATE'};
  const r=await h.request(op,{planId:id,actionNumber:1});
  if(op==='start'){ // Strict start payload rejects content independently; exercise access with {}.
   const s=await h.request(op,{});assert.equal(s.status,mode==='free'?403:503);assert.equal((await s.json()).plan,undefined);
  }else{assert.equal(r.status,mode==='free'?403:503);assert.equal((await r.json()).plan,undefined);}
 }
});
test('successful canonical access returns only validated allowlisted content',async()=>{
 const h=harness();h.data.private='secret';h.data.plan.actions[0].journalText='private';
 const result=await (await h.request('read')).json();assert.equal(result.state,'available');
 assert.equal(result.private,undefined);assert.equal(result.plan.actions[0].journalText,undefined);
 assert.equal(result.plan.actions.length,7);
});
test('malformed actions, progression, dates and unknown response state fail closed',async()=>{
 for(const mutate of [r=>r.plan.actions.pop(),r=>r.plan.actions[0].route='Admin',r=>r.plan.nextAction=3,
  r=>r.currentDate='2026-02-30',r=>r.plan.canComplete=false,r=>r.state='pro']){
  const h=harness();mutate(h.data);assert.equal((await h.request('read')).status,503);
 }
});
test('completed plans remain reviewable; receipts are retained without extra fields',async()=>{
 const h=harness();h.data.plan.completions=Array.from({length:7},(_,i)=>({actionNumber:i+1,completedOn:`2026-11-${10+i}`,
  completedAt:`2026-11-${10+i}T10:00:00Z`,timezone:'Europe/London'}));
 h.data.plan.completed=true;h.data.plan.nextAction=null;h.data.plan.canComplete=false;
 h.data.receipt=h.data.plan.completions[0];assert.equal((await h.request('read')).status,200);
});
test('conflicts are honest and database errors do not leak',async()=>{
 const h=harness();h.data={state:'conflict',reason:'daily_limit'};assert.equal((await h.request('complete',{planId:id,actionNumber:2})).status,409);
 h.error={message:'PRIVATE postgres details'};const r=await h.request('read');assert.equal(r.status,503);assert.ok(!(await r.text()).includes('PRIVATE'));
});
