import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import ts from 'typescript';import {readFileSync} from 'node:fs';import * as crypto from 'node:crypto';
function load(path,deps,extras={}){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Request,Response,URL,Date,Buffer,ReadableStream,TextEncoder,process:{env:{PRIVACY_RECENT_AUTH_SECONDS:'300',PRIVACY_CONFIRMATION_SECONDS:'120',PRIVACY_OPERATIONS_ENABLED:'true'}},require:id=>{assert.ok(id in deps,id);return deps[id];},...extras});return exports;}
const owner='05000000-0000-4000-8000-000000000001',id='05000000-0000-4000-8000-000000000011';
function harness(options={}){const h={calls:[],user:{id:owner,email:'owner@example.invalid',email_confirmed_at:new Date().toISOString(),last_sign_in_at:new Date().toISOString()},error:null};
const admin={from:()=>({select:()=>({eq:async()=>({data:[],error:null})})}),auth:{getSession:async()=>({data:{session:{access_token:token()}}}),getUser:async()=>({data:{user:h.user},error:h.error})},rpc:async(name,args)=>{h.calls.push({name,args});return {data:{id,kind:'export',state:'queued'},error:null};}};
const diagnostics={console:options.console??{info(){},warn(){}},process:{env:{PRIVACY_RECENT_AUTH_SECONDS:'300',PRIVACY_CONFIRMATION_SECONDS:'120',PRIVACY_OPERATIONS_ENABLED:'true',...options.env}}};
const auth=load('src/lib/privacy/auth.ts',{'node:crypto':crypto,'@/utils/supabase/admin':{createAdminSupabaseClient:()=>admin},'@/utils/supabase/server':{createServerSupabaseClient:async()=>admin}},diagnostics);
const operations=load('src/lib/privacy/operations.ts',{'./auth':auth,'./external-cleanup':{openCleanup:JSON.parse,sealCleanup:JSON.stringify,acquireAppleRevocationToken:async()=> 'fixture-token'}},diagnostics);return {...h,auth,operations,admin,h};}
const token=(at=Date.now(),sub=owner)=>'header.'+Buffer.from(JSON.stringify({sub,session_id:id,amr:[{method:'password',timestamp:Math.floor(at/1000)}]})).toString('base64url')+'.signature';
const req=(body,at)=>new Request('https://fixture.invalid/api/account/export',{method:'POST',headers:{Authorization:'Bearer '+token(at)},body:JSON.stringify(body)});

test('worker POST requires exact Bearer authentication and enabled rollout before any work',async()=>{
 for(const [authorization,secret,enabled,expected] of [
  [null,'fixture-secret','true',401],['fixture-secret','fixture-secret','true',401],
  ['Bearer wrong','fixture-secret','true',401],['Bearer fixture-secret',undefined,'true',401],
  ['Bearer fixture-secret','fixture-secret','false',503],['Bearer fixture-secret','fixture-secret','true',200]]) {
  const h=harness();let calls=0;
  const route=load('src/app/api/privacy/process/route.ts',{'node:crypto':crypto,
   '@/utils/supabase/admin':{createAdminSupabaseClient:()=>h.admin},'@/lib/privacy/auth':h.auth,
   '@/lib/privacy/worker':{runPrivacyWorker:async()=>{calls++;return {processed:0,deferred:0};}}},
   {process:{env:{PRIVACY_WORKER_SECRET:secret,PRIVACY_OPERATIONS_ENABLED:enabled}}});
  const response=await route.POST(new Request('https://fixture.invalid/api/privacy/process',{method:'POST',headers:authorization?{Authorization:authorization}:{}}));
  assert.equal(response.status,expected);assert.equal(calls,expected===200?1:0);
  assert.match(response.headers.get('X-Privacy-Request-ID'),/^[a-f0-9]{32}$/);
  assert.equal(route.GET,undefined);assert.equal(route.maxDuration,60);
 }
});

test('overlapping worker invocations respect exclusive claims; provider failure stays deferred',async()=>{
 const h=harness();let leased=false,started=0,release;const patches=[];
 const wait=new Promise(resolve=>release=resolve);
 const worker=load('src/lib/privacy/worker.ts',{
  './auth':h.auth,'./export':{},'./operations':{checkpoint:async(_a,_o,p)=>patches.push(p)},
  './deletion':{processDeletion:async()=>{started++;await wait;throw new h.auth.PrivacyError('provider_pending');}},
 });
 const admin={rpc:async name=>{
  if(name==='cleanup_account_privacy_retention')return {error:null};
  assert.equal(name,'claim_account_privacy_operations');
  if(leased)return {data:[],error:null};leased=true;
  return {data:[{id,kind:'delete',attempts:1,account_removed_at:null}],error:null};
 }};
 const first=worker.runPrivacyWorker(admin);
 await new Promise(resolve=>setImmediate(resolve));
 const second=await worker.runPrivacyWorker(admin);
 assert.equal(started,1);assert.equal(second.processed,0);
 release();const result=await first;
 assert.equal(result.processed,0);assert.equal(result.deferred,1);
 assert.equal(patches[0].state,'queued');assert.equal(patches[0].lease_token,null);
 assert.equal(patches[0].completed_at,undefined);
});

test('scheduler setup queues authenticated POST through Vault and installs disabled',()=>{
 const sql=readFileSync(new URL('../supabase/privacy-worker-scheduler.sql',import.meta.url),'utf8');
 assert.match(sql,/net\.http_post/);assert.doesNotMatch(sql,/net\.http_get/);
 assert.match(sql,/vault\.decrypted_secrets/);assert.match(sql,/'Bearer ' \|\| worker_secret/);
 assert.match(sql,/active := false/);assert.match(sql,/from public, anon, authenticated, service_role/);
 assert.match(sql,/set search_path = pg_catalog/);
});
test('privacy API derives owner from verified Auth and hashes capabilities',async()=>{const {h,operations}=harness();const r=await operations.handleRequest(req({operationId:id,confirmation:'a'.repeat(43),recovery:'b'.repeat(43)}),'export');assert.equal(r.status,202);assert.equal(h.calls[0].args.p_user_id,owner);assert.equal(h.calls[0].args.p_confirmation_hash.length,64);assert.notEqual(h.calls[0].args.p_recovery_hash,'b'.repeat(43));});
test('privacy API rejects client ownership and recipient overrides',async()=>{for(const extra of [{userId:'other'},{destination:'other@example.invalid'},{access:true}]){const {h,operations}=harness();const r=await operations.handleRequest(req({operationId:id,confirmation:'a'.repeat(43),recovery:'b'.repeat(43),...extra}),'export');assert.equal(r.status,400);assert.equal(h.calls.length,0);}});
test('anonymous and failed Auth checks never reach privacy RPC',async()=>{const {h,operations}=harness();h.user=null;assert.equal((await operations.handleConfirmation(req({operationId:id,kind:'delete'}))).status,401);assert.equal(h.calls.length,0);});
test('cookie mutation rejects cross-origin requests',async()=>{const {auth}=harness();await assert.rejects(auth.authenticatePrivacy(new Request('https://fixture.invalid/api/account/delete',{method:'POST',headers:{origin:'https://evil.invalid'}})),e=>e.code==='unauthorized');});
test('confirmation binds verified email and refuses stale identity',async()=>{const {h,operations}=harness();let r=await operations.handleConfirmation(req({operationId:id,kind:'export'}));assert.equal(r.status,200);assert.equal(h.calls[0].args.p_destination,h.user.email);assert.equal((await r.json()).destination,h.user.email);h.user.last_sign_in_at=new Date().toISOString();r=await operations.handleConfirmation(req({operationId:id,kind:'delete'},0));assert.equal(r.status,403);});
test('missing verified email blocks export but not deletion confirmation',async()=>{const {h,operations}=harness();h.user.email_confirmed_at=null;assert.equal((await operations.handleConfirmation(req({operationId:id,kind:'export'}))).status,403);assert.equal((await operations.handleConfirmation(req({operationId:id,kind:'delete'}))).status,200);});
test('privacy errors never include raw private exception content',async()=>{const {auth}=harness();const r=auth.privacyFailure(Error('private journal/token'));assert.equal(r.status,503);assert.equal((await r.json()).reason,'operation_unavailable');assert.equal(r.headers.get('cache-control'),'private, no-store');});
test('recent-auth rejects future and invalid dates',()=>{const {auth}=harness();for(const d of ['invalid','2100-01-01T00:00:00Z'])assert.throws(()=>auth.requireRecentIdentity(d));});

test('Apple confirmation binds exchanged grant to verified identity and stores only sealed cleanup',async()=>{
 const {h,operations}=harness();h.user.identities=[{provider:'apple',identity_data:{sub:'fixture-subject'}}];
 const result=await operations.handleConfirmation(req({operationId:id,kind:'delete',appleAuthorizationCode:'fixture-code'}));
 assert.equal(result.status,200);assert.equal(JSON.parse(h.calls[0].args.p_cleanup_material).appleRefreshToken,'fixture-token');
 assert.ok(!JSON.stringify(await result.json()).includes('fixture-token'));
});
test('Apple code cannot be attached to an unrelated verified Auth identity',async()=>{
 const {h,operations}=harness();h.user.identities=[];
 assert.equal((await operations.handleConfirmation(req({operationId:id,kind:'delete',appleAuthorizationCode:'fixture-code'}))).status,403);
 assert.equal(h.calls.length,0);
});

function verificationHarness(){const h=harness();const sends=[];h.admin.auth.resend=async args=>{sends.push(args);return {error:null};};
 const route=load('src/app/api/account/privacy-verification/route.ts',{'@/lib/privacy/operations':h.operations,'@/lib/privacy/auth':h.auth,
 '@/lib/privacy/external-cleanup':{sealCleanup:JSON.stringify,openCleanup:JSON.parse},'@/utils/supabase/admin':{createAdminSupabaseClient:()=>h.admin}},{Headers,URLSearchParams});return {...h,route,sends};}
test('verification email uses only Auth destination and rejects substitution',async()=>{
 const h=verificationHarness();h.h.user.email_confirmed_at=null;
 assert.equal((await h.route.POST(req({action:'verify_email',email:'attacker@example.invalid'}))).status,400);assert.equal(h.sends.length,0);
 assert.equal((await h.route.POST(req({action:'verify_email'}))).status,200);assert.equal(h.sends[0].email,h.h.user.email);
});
test('missing account email is explicit without changing deletion permission',async()=>{
 const h=verificationHarness();h.h.user.email=null;h.h.user.email_confirmed_at=null;
 assert.equal((await h.route.POST(req({action:'verify_email'}))).status,409);assert.equal(h.sends.length,0);
 assert.equal((await h.operations.handleConfirmation(req({operationId:id,kind:'delete'}))).status,200);
});
test('Apple web callback rejects absent browser state before provider exchange',async()=>{
 const h=verificationHarness();const response=await h.route.POST(new Request('https://fixture.invalid/api/account/privacy-verification',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'state=forged&code=forged'}));
 assert.equal(response.status,403);assert.equal(h.h.calls.length,0);
});

test('download uses authenticated owner and denies missing expired or other-owner artifact',async()=>{
 const h=harness();const seen=[];h.admin.rpc=async(name,args)=>{seen.push({name,args});return {data:null,error:null};};
 const route=load('src/app/api/account/exports/[id]/download/route.ts',{'@/lib/privacy/auth':h.auth,'@/lib/privacy/export-pdf':{renderExportPdf(){throw Error('JSON must not render PDF');}},'node:fs':{}});
 const result=await route.GET(new Request('https://fixture.invalid/api/account/exports/'+id+'/download',{headers:{Authorization:'Bearer fixture','X-Privacy-Recovery':'a'.repeat(43)}}),{params:Promise.resolve({id})});
 assert.equal(result.status,404);assert.equal(seen[0].args.p_user_id,owner);
 h.h.user=null;assert.equal((await route.GET(new Request('https://fixture.invalid/api/account/exports/'+id+'/download'),{params:Promise.resolve({id})})).status,401);
});

test('Apple callback stores grant server-side and browser receives no provider token',async()=>{
 const h=harness();h.admin.auth.admin={getUserById:async()=>({data:{user:{identities:[{provider:'apple',identity_data:{sub:'subject'}}]}},error:null})};
 const context={owner,operationId:id,subject:'subject',nonce:'nonce',expires:Date.now()+60000};
 const route=load('src/app/api/account/privacy-verification/route.ts',{'@/lib/privacy/operations':h.operations,'@/lib/privacy/auth':h.auth,'@/utils/supabase/admin':{createAdminSupabaseClient:()=>h.admin},
 '@/lib/privacy/external-cleanup':{openCleanup:()=>context,sealCleanup:value=>Buffer.from(JSON.stringify(value)).toString('base64url'),acquireAppleRevocationToken:async()=> 'private-provider-fixture'}},
 {Headers,URLSearchParams,process:{env:{PRIVACY_PUBLIC_ORIGIN:'https://fixture.invalid'}}});
 const response=await route.POST(new Request('https://fixture.invalid/api/account/privacy-verification',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',cookie:'privacy_apple_state=fixture-state'},body:'state=fixture-state&code=fixture-code'}));
 assert.equal(response.status,303);assert.equal(h.h.calls.length,1);
 assert.equal(JSON.parse(Buffer.from(h.h.calls[0].args.p_cleanup_material,'base64url').toString()).appleRefreshToken,'private-provider-fixture');
 const cookies=response.headers.get('set-cookie');assert.ok(!cookies.includes('private-provider-fixture'));
 const grant=cookies.match(/privacy_apple_grant=([^;]+)/)[1];assert.equal(JSON.parse(Buffer.from(grant,'base64url').toString()).token,undefined);
 context.expires=0;assert.equal((await route.POST(new Request('https://fixture.invalid/api/account/privacy-verification',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',cookie:'privacy_apple_state=fixture-state'},body:'state=fixture-state&code=fixture-code'}))).status,403);
 assert.equal(h.h.calls.length,1);
});

test('stale Apple cookie does not block another owner confirmation',async()=>{
 const {operations,h}=harness(); const r=req({operationId:id,kind:'delete'});
 r.headers.set('cookie','privacy_apple_grant='+JSON.stringify({owner:'other',operationId:id,expires:Date.now()+60000}));
 assert.equal((await operations.handleConfirmation(r)).status,200);assert.equal(h.calls[0].args.p_cleanup_material,null);
});
test('recent account-wide login cannot refresh an old requesting session',async()=>{
 const {operations,h}=harness(); h.user.last_sign_in_at=new Date().toISOString();
 assert.equal((await operations.handleConfirmation(req({operationId:id,kind:'export'},Date.now()-3600000))).status,403);
 assert.equal(h.calls.length,0);
});
test('large download streams bounded Unicode chunks and revokes between reads',async()=>{
 const h=harness();const text=JSON.stringify({journal:'\u{1F642}'.repeat(1300000)});const chars=Array.from(text);let revoked=false;let largest=0;
 h.admin.rpc=async(name,args)=>{assert.equal(name,'read_account_export_chunk');if(revoked)return {data:null,error:null};const part=chars.slice(args.p_offset,args.p_offset+args.p_limit).join('');largest=Math.max(largest,part.length);return {data:{text:part,length:chars.length},error:null};};
 const route=load('src/app/api/account/exports/[id]/download/route.ts',{'@/lib/privacy/auth':h.auth,'@/lib/privacy/export-pdf':{renderExportPdf(){throw Error('JSON must not render PDF');}},'node:fs':{}});
 const get=()=>route.GET(new Request('https://fixture.invalid/download',{headers:{Authorization:'Bearer '+token()}}),{params:Promise.resolve({id})});
 const response=await get();assert.equal(await response.text(),text);assert.ok(largest<=131072);assert.equal(response.headers.get('cache-control'),'private, no-store');
 const interrupted=await get();const reader=interrupted.body.getReader();await reader.read();revoked=true;await assert.rejects(async()=>{while(!(await reader.read()).done){}});
});

test('verified email returns authoritative destination without requesting another email', async()=>{
 const h=verificationHarness();const result=await h.route.POST(req({action:'verify_email'}));
 assert.equal(result.status,200);assert.deepEqual(await result.json(),{state:'verified',email:h.h.user.email});assert.equal(h.sends.length,0);
});
test('verification acceptance names the server recipient and provider rejection never claims acceptance',async()=>{
 const h=verificationHarness();h.h.user.email_confirmed_at=null;
 const accepted=await h.route.POST(req({action:'verify_email'}));assert.deepEqual(await accepted.json(),{state:'verification_requested',email:h.h.user.email});
 h.admin.auth.resend=async()=>({error:{message:'private provider diagnostic'}});
 const failed=await h.route.POST(req({action:'verify_email'}));assert.equal(failed.status,503);
 assert.deepEqual(await failed.json(),{state:'unavailable',reason:'email_verification_unavailable'});
});
test('verification requires recent authentication and never sends for expired identity evidence',async()=>{
 const h=verificationHarness();h.h.user.email_confirmed_at=null;
 const result=await h.route.POST(req({action:'verify_email'},Date.now()-600000));
 assert.equal(result.status,403);assert.equal((await result.json()).reason,'reauthentication_required');assert.equal(h.sends.length,0);
});

test('privacy correlation spans preparation success and failures without private log content',async()=>{
 const events=[];const h=harness({env:{PRIVACY_DEBUG:'true'},console:{info:(tag,event)=>events.push({tag,...event}),warn:(tag,event)=>events.push({tag,...event})}});
 const request=req({operationId:id,kind:'delete'});request.headers.set('X-Privacy-Request-ID',id);
 const response=await h.operations.handleConfirmation(request);assert.equal(response.status,200);assert.equal(response.headers.get('x-privacy-request-id'),id);
 assert.equal(events[0].correlationId,id);assert.equal(events[0].reason,'ok');assert.equal(typeof events[0].durationMs,'number');
 const payload=await response.json();assert.ok(payload.confirmation);assert.ok(!JSON.stringify(events).includes(payload.confirmation));assert.ok(!JSON.stringify(events).includes(h.h.user.email));
});
test('missing configuration and stale authentication have separate stages, correlated errors and no RPC calls',async()=>{
 for(const config of [true,false]){
  const events=[];const h=harness({env:config?{PRIVACY_RECENT_AUTH_SECONDS:''}:{},console:{info(){},warn:(_,event)=>events.push(event)}});
  const r=await h.operations.handleConfirmation(req({operationId:id,kind:'delete'},config?Date.now():Date.now()-600000));
  assert.equal(r.status,config?503:403);assert.match(r.headers.get('x-privacy-request-id'),/^[a-f0-9]{32}$/);
  assert.equal(events[0].stage,'recent_auth');assert.equal(events[0].reason,config?'verification_configuration_required':'reauthentication_required');assert.equal(h.h.calls.length,0);
 }
});
test('RPC permission or missing migration diagnostics preserve generic confirmation response and omit raw messages',async()=>{
 for(const code of ['42501','PGRST202','42P01']){
  const events=[];const h=harness({console:{info(){},warn:(_,event)=>events.push(event)}});
  h.admin.rpc=async()=>({error:{code,message:'PRIVATE payload owner@example.invalid Bearer token'},data:null});
  const r=await h.operations.handleConfirmation(req({operationId:id,kind:'delete'}));assert.equal(r.status,503);
  assert.equal((await r.json()).reason,'confirmation_unavailable');assert.equal(events[0].stage,'confirmation_rpc');assert.equal(events[0].safeErrorCode,code);
  assert.equal(events[0].reason,code==='42501'?'rpc_permission_denied':'rpc_unavailable');assert.doesNotMatch(JSON.stringify(events),/PRIVATE|owner@example|Bearer/);
 }
});
test('debug is opt-in; failures remain observable and malformed correlation headers are replaced',async()=>{
 const events=[];const h=harness({console:{info:(_,event)=>events.push(event),warn:(_,event)=>events.push(event)}});
 await h.operations.handleConfirmation(req({operationId:id,kind:'delete'}));assert.equal(events.length,0);
 const request=req({operationId:'bad',kind:'delete'});request.headers.set('X-Privacy-Request-ID','private arbitrary value');
 const failed=await h.operations.handleConfirmation(request);assert.equal(failed.status,400);assert.match(failed.headers.get('x-privacy-request-id'),/^[a-f0-9]{32}$/);
 assert.equal(events.length,1);assert.equal(events[0].reason,'invalid_request');assert.doesNotMatch(JSON.stringify(events),/private arbitrary value/);
});
test('disabled deletion and invalid confirmations remain distinct and do not weaken submission rules',async()=>{
 const events=[];const h=harness({env:{PRIVACY_OPERATIONS_ENABLED:'false'},console:{info(){},warn:(_,event)=>events.push(event)}});
 let r=await h.operations.handleRequest(req({operationId:id,confirmation:'a'.repeat(43),recovery:'b'.repeat(43)}),'delete');
 assert.equal(r.status,503);assert.equal(events[0].reason,'setup_pending');assert.equal(events[0].stage,'rollout_gate');assert.equal(h.h.calls.length,0);
 const active=harness({console:{info(){},warn:(_,event)=>events.push(event)}});
 active.admin.rpc=async()=>({error:{code:'42501',message:'Confirmation required'},data:null});
 r=await active.operations.handleRequest(req({operationId:id,confirmation:'a'.repeat(43),recovery:'b'.repeat(43)}),'delete');
 assert.equal(r.status,409);assert.equal(events.at(-1).reason,'confirmation_required');assert.equal(events.at(-1).stage,'submission_rpc');
});
test('controlled deletion RPC fixture binds owner and reuses accepted result on duplicate/lost-response submission',async()=>{
 const h=harness();let saved=null;let inserts=0;
 const confirmation='a'.repeat(43),recovery='b'.repeat(43);
 h.admin.rpc=async(name,args)=>{
  assert.equal(name,'request_account_privacy_operation');
  if(args.p_user_id!==owner||args.p_confirmation_hash!==h.auth.hashSecret(confirmation))return {data:null,error:{code:'42501',message:'Confirmation required'}};
  if(!saved){saved={id,kind:'delete',state:'queued'};inserts++;}
  return {data:saved,error:null};
 };
 const body={operationId:id,confirmation,recovery};
 const first=await h.operations.handleRequest(req(body),'delete');assert.equal(first.status,202);
 const retry=await h.operations.handleRequest(req(body),'delete');assert.deepEqual(await first.json(),await retry.json());assert.equal(inserts,1);
 h.h.user.id='05000000-0000-4000-8000-000000000002';
 const wrong=req(body);wrong.headers.set('Authorization','Bearer '+token(Date.now(),h.h.user.id));
 assert.equal((await h.operations.handleRequest(wrong,'delete')).status,409);assert.equal(inserts,1);
});
