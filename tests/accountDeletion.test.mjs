import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import ts from 'typescript';import {readFileSync} from 'node:fs';import * as crypto from 'node:crypto';
class PrivacyError extends Error{constructor(code){super(code);this.code=code;}}
function load(path,deps,extras={}){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Buffer,Date,URL,URLSearchParams,AbortSignal,process:{env:{PRIVACY_CLEANUP_KEY:Buffer.alloc(32,1).toString('base64')}},require:id=>{assert.ok(id in deps,id);return deps[id];},...extras});return exports;}
function harness(){const h={calls:[],patches:[],storage:[{bucket:'fixture',path:'owner/file'}],apple:false,integrations:[],failStorage:false,failExternal:false};const deps={'@/lib/analytics/privacy':{erasePosthogOwner:async()=>{throw Error('remote analytics disabled in legacy fixture');}},'./auth':{PrivacyError},'./operations':{checkpoint:async(a,o,p)=>{h.patches.push(p);}},'./external-cleanup':{sealCleanup:v=>JSON.stringify(v),openCleanup:JSON.parse,deleteOneSignalOwner:async()=>{h.calls.push('onesignal');if(h.failExternal)throw new PrivacyError('external_failed');},revokeAppleToken:async()=>{h.calls.push('apple');},revokeWearableAuthorization:async integration=>{if(!['garmin','fitbit'].includes(integration.provider))throw new PrivacyError('unsupported_integration_provider');h.calls.push(integration.provider);}}};const api=load('src/lib/privacy/deletion.ts',deps);const admin={auth:{admin:{getUserById:async()=>({data:{user:{identities:h.apple?[{provider:'apple'}]:[]}},error:null}),deleteUser:async()=>{h.calls.push('auth');return {error:null};}}},from:()=>({select:()=>({eq:async()=>({data:h.integrations,error:null})})}),rpc:async(name)=>{h.calls.push(name);if(name==='prepare_analytics_erasure')return {data:'clear',error:null};if(name==='list_account_privacy_objects'){const data=h.storage;h.storage=[];return {data,error:null};}return {data:true,error:null};},storage:{from:()=>({remove:async()=>{h.calls.push('storage');return {error:h.failStorage?{}:null};}})}};return {h,api,admin,op:{id:'id',user_id:'owner',lease_token:'lease',checkpoint:{},account_removed_at:null}};}
test('deletion removes storage before private cleanup and Auth; completion follows external cleanup',async()=>{const {h,api,admin,op}=harness();await api.processDeletion(admin,op);assert.ok(h.calls.indexOf('storage')<h.calls.indexOf('auth'));assert.ok(h.calls.indexOf('cleanup_account_private_records')<h.calls.indexOf('auth'));assert.ok(h.calls.indexOf('auth')<h.calls.indexOf('onesignal'));assert.equal(h.patches.at(-1).state,'completed');assert.ok(h.patches.some(p=>p.state==='account_removed'));});
test('failed storage cleanup never deletes Auth',async()=>{const {h,api,admin,op}=harness();h.failStorage=true;await assert.rejects(api.processDeletion(admin,op));assert.ok(!h.calls.includes('auth'));assert.ok(!h.patches.some(p=>p.state==='completed'));});
test('external failure after Auth removal never claims cleanup completed',async()=>{const {h,api,admin,op}=harness();h.failExternal=true;await assert.rejects(api.processDeletion(admin,op));assert.ok(op.account_removed_at);assert.ok(!h.patches.some(p=>p.state==='completed'));});
test('missing Apple revocation evidence is explicit not a successful stub',async()=>{const {h,api,admin,op}=harness();h.apple=true;await assert.rejects(api.processDeletion(admin,op),e=>e.code==='apple_revocation_evidence_required');assert.ok(!h.patches.some(p=>p.state==='completed'));});
test('unknown wearable provider remains an explicit failure',async()=>{const {h,api,admin,op}=harness();h.integrations=[{provider:'unknown'}];await assert.rejects(api.processDeletion(admin,op),e=>e.code==='unsupported_integration_provider');});
test('cleanup evidence is authenticated encrypted and rejects alteration',()=>{const api=load('src/lib/privacy/external-cleanup.ts',{'node:crypto':crypto,'./auth':{PrivacyError},'@/lib/wearables/tokens':{encryptWearableToken(){throw Error('unused');}}});const token='fixture-private-token';const sealed=api.sealCleanup({token});assert.ok(!sealed.includes(token));assert.equal(api.openCleanup(sealed).token,token);const parts=sealed.split('.');parts[1]=Buffer.alloc(16).toString('base64url');assert.throws(()=>api.openCleanup(parts.join('.')));});

test('confirmed Apple revocation and Fitbit cleanup finish before final deletion completion',async()=>{
 const {h,api,admin,op}=harness();h.apple=true;h.integrations=[{provider:'fitbit'}];
 op.checkpoint.appleRevocation=JSON.stringify({appleRefreshToken:'fixture-token'});
 await api.processDeletion(admin,op);
 assert.ok(h.calls.includes('apple'));assert.ok(h.calls.includes('fitbit'));assert.equal(h.patches.at(-1).state,'completed');
 assert.deepEqual(JSON.parse(JSON.stringify(h.patches.at(-1).checkpoint)),{});
});


function providerHarness(responses) {
 const env={PRIVACY_CLEANUP_KEY:Buffer.alloc(32,1).toString('base64'),WEARABLE_TOKEN_ENCRYPTION_KEY:'fixture-only',GARMIN_CLIENT_ID:'fixture',GARMIN_CLIENT_SECRET:'fixture'};
 const tokens=load('src/lib/wearables/tokens.ts',{'node:crypto':{...crypto,default:crypto}},{process:{env}});
 const calls=[];const api=load('src/lib/privacy/external-cleanup.ts',{'node:crypto':crypto,'./auth':{PrivacyError},'@/lib/wearables/tokens':tokens},
  {process:{env},fetch:async(url,init)=>{calls.push({url,init});const next=responses.shift();if(next instanceof Error)throw next;assert.ok(next,'unexpected request');return next;}});
 return {api,calls,tokens, integration:{provider:'garmin',access_token:tokens.encryptWearableToken('old-access'),refresh_token:tokens.encryptWearableToken('old-refresh')}};
}
test('Garmin cleanup uses official registration deletion with the stored bearer token',async()=>{
 const h=providerHarness([{ok:true,status:204}]);await h.api.revokeWearableAuthorization(h.integration);
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'https://apis.garmin.com/wellness-api/rest/user/registration');
 assert.equal(h.calls[0].init.method,'DELETE');assert.equal(h.calls[0].init.headers.Authorization,'Bearer old-access');
});
test('Garmin refresh is persisted before retry and survives a failed delete request',async()=>{
 const h=providerHarness([{ok:false,status:401},{ok:true,json:async()=>({access_token:'new-access',refresh_token:'new-refresh'})},Error('network')]);let saved;
 await assert.rejects(h.api.revokeWearableAuthorization(h.integration,async next=>{assert.equal(h.calls.length,2);saved=next;}),/network/);
 assert.equal(h.calls[1].url,'https://diauth.garmin.com/di-oauth2-service/oauth/token');
 assert.equal(h.calls[1].init.body.get('grant_type'),'refresh_token');assert.equal(h.calls[1].init.body.get('refresh_token'),'old-refresh');
 assert.notEqual(saved.refresh_token,h.integration.refresh_token);assert.ok(!saved.refresh_token.includes('new-refresh'));
 assert.equal(h.calls[2].init.headers.Authorization,'Bearer new-access');
});
test('Garmin failed refresh or checkpoint never issues the second deletion',async()=>{
 for(const failSave of [false,true]){const h=providerHarness([{ok:false,status:401},failSave?{ok:true,json:async()=>({access_token:'new',refresh_token:'new'})}:{ok:false,status:400}]);
 await assert.rejects(h.api.revokeWearableAuthorization(h.integration,async()=>{throw Error('checkpoint unavailable');}));assert.equal(h.calls.length,2);}
});
test('unknown providers never call Garmin and unsuccessful deregistration never claims success',async()=>{
 const unknown=providerHarness([]);await assert.rejects(unknown.api.revokeWearableAuthorization({provider:'other'}),e=>e.code==='unsupported_integration_provider');assert.equal(unknown.calls.length,0);
 const denied=providerHarness([{ok:false,status:403}]);await assert.rejects(denied.api.revokeWearableAuthorization(denied.integration),e=>e.code==='garmin_revocation_failed');
});
test('accounts without integrations do not require Garmin configuration',async()=>{
 const {api,admin,op,h}=harness();await api.processDeletion(admin,op);assert.ok(!h.calls.includes('garmin'));assert.equal(h.patches.at(-1).state,'completed');
});

 test('Auth already removed after lost checkpoint resumes required cleanup',async()=>{
 const {h,api,admin,op}=harness();op.checkpoint={storage:true,external:JSON.stringify({integrations:[]})};
 admin.auth.admin.getUserById=async()=>({data:{user:null},error:{status:404}});
 await api.processDeletion(admin,op);assert.ok(!h.calls.includes('auth'));assert.ok(h.calls.includes('onesignal'));assert.equal(h.patches.at(-1).state,'completed');
 });
 test('Auth lookup failure never becomes evidence of removal',async()=>{
 const {h,api,admin,op}=harness();op.checkpoint={storage:true,external:JSON.stringify({integrations:[]})};
 admin.auth.admin.getUserById=async()=>({data:{user:null},error:{status:503}});
 await assert.rejects(api.processDeletion(admin,op),e=>e.code==='cleanup_identity_unavailable');assert.ok(!h.calls.includes('onesignal'));assert.ok(!h.patches.some(p=>p.state==='completed'));
 });

test('worker recovery releases failed leases and never purges pending deletion as completed',async()=>{
 const patches=[];const o={id:'fixture',kind:'delete',attempts:8,account_removed_at:'2026-11-18T00:00:00Z'};
 const api=load('src/lib/privacy/worker.ts',{'./export':{},'./deletion':{processDeletion:async()=>{throw new PrivacyError('provider_pending');}},'./operations':{checkpoint:async(a,op,patch)=>patches.push(patch)},'./auth':{PrivacyError}});
 const calls=[];const result=await api.runPrivacyWorker({rpc:async name=>{calls.push(name);return {data:name==='claim_account_privacy_operations'?[o]:null,error:null};}});
 assert.equal(result.deferred,1);assert.equal(patches[0].state,'failed');assert.equal(patches[0].completed_at,undefined);assert.equal(patches[0].lease_token,null);assert.equal(patches[0].failure_code,'provider_pending');
 assert.deepEqual(calls,['cleanup_account_privacy_retention','claim_account_privacy_operations']);
});

test('Apple web grant exchange binds subject audience nonce and uses web revocation client',async()=>{
 const calls=[];const env={PRIVACY_APPLE_WEB_CLIENT_ID:'web-service',PRIVACY_APPLE_WEB_CLIENT_SECRET:'fixture',PRIVACY_PUBLIC_ORIGIN:'https://fixture.invalid'};
 let claims={sub:'subject',iss:'https://appleid.apple.com',aud:'web-service',exp:Math.floor(Date.now()/1000)+300,nonce:'expected'};
 const api=load('src/lib/privacy/external-cleanup.ts',{'node:crypto':crypto,'./auth':{PrivacyError},'@/lib/wearables/tokens':{}},{process:{env},fetch:async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({id_token:'header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature',refresh_token:'fixture-refresh'})};}});
 assert.equal(await api.acquireAppleRevocationToken('code','subject',true,'expected'),'fixture-refresh');
 assert.equal(calls[0].init.body.get('client_id'),'web-service');assert.equal(calls[0].init.body.get('redirect_uri'),'https://fixture.invalid/api/account/privacy-verification');
 await api.revokeAppleToken('fixture-refresh',true);assert.equal(calls[1].init.body.get('client_id'),'web-service');
 for(const patch of [{sub:'other'},{aud:'native-app'},{nonce:'wrong'},{exp:0}]){const original=claims;claims={...claims,...patch};await assert.rejects(api.acquireAppleRevocationToken('code','subject',true,'expected'),e=>e.code==='apple_identity_mismatch');claims=original;}
});
