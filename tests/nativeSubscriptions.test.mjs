import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('native subscription schema and manual-grant migration are additive', async () => {
  const [schema, foundation] = await Promise.all([
    source('supabase/schema.sql'),
    source('supabase/migrations/20261017090000_manual_pro_grant_foundation.sql'),
  ]);
  assert.match(schema, /create table if not exists public\.subscription_entitlements/);
  assert.match(schema, /create table if not exists public\.subscription_account_links/);
  assert.match(schema, /create table if not exists public\.subscription_provider_events/);
  assert.match(schema, /create table if not exists public\.subscription_verification_rate_limits/);
  assert.match(schema, /add column if not exists is_pro boolean not null default false/);
  assert.match(foundation, /add column if not exists manual_pro_grant boolean not null default false/);
});

test('billing compatibility fields and entitlement records are server managed', async () => {
  const [foundation, schema] = await Promise.all([
    source('supabase/migrations/20261017090000_manual_pro_grant_foundation.sql'),
    source('supabase/schema.sql'),
  ]);
  for (const field of ['is_pro', 'stripe_customer_id', 'stripe_subscription_id', 'subscription_status']) {
    assert.ok(foundation.includes(field), `Missing protected profile field ${field}`);
  }
  assert.match(foundation, /new\.manual_pro_grant is distinct from old\.manual_pro_grant/);
  for (const table of [
    'subscription_entitlements',
    'subscription_account_links',
    'subscription_provider_events',
    'subscription_verification_rate_limits',
  ]) {
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(schema, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
  }
  assert.match(schema, /coalesce\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(schema, /Subscription already belongs to another user/);
});

test('entitlement and lifecycle claims remain concurrency safe and idempotent', async () => {
  const migration = await source('supabase/migrations/20260820120000_native_subscriptions.sql');
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('subscription:' \|\| p_user_id::text, 0\)\)/);
  assert.match(migration, /pg_advisory_xact_lock\([\s\S]*'subscription-event:' \|\| p_provider \|\| ':' \|\| p_event_id/);
  assert.match(migration, /unique \(provider, provider_subscription_id\)/);
  assert.match(migration, /unique \(provider, event_id\)/);
  assert.match(migration, /current_status = 'completed'/);
  assert.match(migration, /current_claimed_at > now\(\) - interval '10 minutes'/);
});

test('native verification uses store signatures, account binding and server-side rate limiting', async () => {
  const [apple, google, appleRoute, googleRoute, rateLimit] = await Promise.all([
    source('src/lib/native-subscriptions/apple.ts'),
    source('src/lib/native-subscriptions/google.ts'),
    source('src/app/api/native-subscriptions/verify/apple/route.ts'),
    source('src/app/api/native-subscriptions/verify/google/route.ts'),
    source('src/lib/native-subscriptions/rate-limit.ts'),
  ]);
  assert.match(apple, /SignedDataVerifier/);
  assert.match(apple, /DAD_HEALTH_BUNDLE_ID/);
  assert.match(appleRoute, /appAccountToken/);
  assert.match(google, /androidpublisher/);
  assert.match(google, /createHmac\("sha256"/);
  assert.match(googleRoute, /obfuscatedExternalAccountId/);
  assert.match(rateLimit, /consume_subscription_verification_rate_limit/);
  assert.doesNotMatch(`${appleRoute}\n${googleRoute}`, /SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY/);
});

test('Apple and Google lifecycle notification routes claim events before applying updates', async () => {
  const [apple, google] = await Promise.all([
    source('src/app/api/native-subscriptions/notifications/apple/route.ts'),
    source('src/app/api/native-subscriptions/notifications/google/route.ts'),
  ]);
  for (const route of [apple, google]) {
    const claim = route.indexOf('claimProviderEvent');
    const upsert = route.lastIndexOf('upsertSubscriptionEntitlement');
    const complete = route.lastIndexOf('completeProviderEvent');
    assert.ok(claim >= 0 && upsert > claim && complete > upsert);
    assert.match(route, /failProviderEvent/);
  }
  assert.match(apple, /verifyAppleNotification/);
  assert.match(google, /verifyGoogleRtdnIdentity/);
});

test('Google RTDN orders verified snapshots by server verification time, not message publish time', async () => {
  const route = await source('src/app/api/native-subscriptions/notifications/google/route.ts');
  const verifiedPurchase = route.indexOf('const purchase = await verifyGooglePurchase(purchaseToken)');
  const savedSnapshot = route.indexOf('entitlement.lastVerifiedAt = verificationStartedAt');
  assert.ok(route.indexOf('const verificationStartedAt = new Date().toISOString()') < verifiedPurchase);
  assert.ok(savedSnapshot > verifiedPurchase);
  assert.doesNotMatch(route, /publishTime|publishedAt/);
});

test('Google verified purchase state maps renewal, cancellation and expiry from current Play data', async () => {
  const google = await source('src/lib/native-subscriptions/google.ts');
  assert.match(google, /case "SUBSCRIPTION_STATE_ACTIVE":[\s\S]*return trialing \? "trialing" : "active"/);
  assert.match(google, /case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":[\s\S]*return "grace_period"/);
  assert.match(google, /case "SUBSCRIPTION_STATE_CANCELED":[\s\S]*expiry > now \? "active" : "canceled"/);
  assert.match(google, /case "SUBSCRIPTION_STATE_EXPIRED":[\s\S]*return "expired"/);
  assert.match(google, /currentPeriodEnd: lineItem\.expiryTime \?\? null/);
});

test('existing Stripe profile sync mirrors lifecycle into the provider-neutral ledger', async () => {
  const sync = await source('src/lib/stripe/sync-user-profile.ts');
  assert.match(sync, /provider: "stripe"/);
  assert.match(sync, /upsertSubscriptionEntitlement/);
  assert.match(sync, /stripe_subscription_id/);
  assert.match(sync, /subscription_status/);
  assert.doesNotMatch(sync, /from\("user_profile"\)|\.update\(|\.insert\(/);
});

test('Stripe profile writes share the serialized entitlement transaction', async () => {
  const [sync, migration, preflight] = await Promise.all([
    source('src/lib/stripe/sync-user-profile.ts'),
    source('supabase/migrations/20261017110000_atomic_stripe_profile_sync.sql'),
    source('supabase/operations/stripe_profile_trigger_preflight.sql'),
  ]);
  const upsert = migration.slice(migration.indexOf('create or replace function public.upsert_subscription_entitlement'));
  const refresh = migration.slice(migration.indexOf('create or replace function public.refresh_effective_subscription_profile'));
  assert.match(sync, /await upsertSubscriptionEntitlement/);
  assert.doesNotMatch(sync, /user_profile|\.update\(|\.insert\(/);
  assert.match(upsert, /pg_advisory_xact_lock\(hashtextextended\('subscription:' \|\| p_user_id::text, 0\)\)/);
  assert.match(upsert, /excluded\.last_verified_at > current_entitlement\.last_verified_at/);
  assert.match(upsert, /Verified subscription expiry is required for Pro access/);
  assert.match(refresh, /update public\.user_profile[\s\S]*subscription_status = compatibility_status[\s\S]*stripe_customer_id[\s\S]*stripe_subscription_id/);
  assert.match(migration, /after insert or update or delete on public\.subscription_entitlements/);
  assert.match(preflight, /pg_get_triggerdef/);
  assert.match(preflight, /pg_get_functiondef/);
  assert.doesNotMatch(preflight, /\b(insert|update|delete|alter|create)\s/i);
});

test('entitlement and profile snapshots serialize together and reject stale webhook times', async () => {
  const [migration, schema] = await Promise.all([
    source('supabase/migrations/20261017110000_atomic_stripe_profile_sync.sql'),
    source('supabase/schema.sql'),
  ]);
  const upsert = migration.slice(migration.indexOf('create or replace function public.upsert_subscription_entitlement'));
  const profileSync = migration.slice(migration.indexOf('create or replace function public.refresh_effective_subscription_profile'));
  assert.match(upsert, /pg_advisory_xact_lock\(hashtextextended\('subscription:' \|\| p_user_id::text, 0\)\)/);
  assert.match(upsert, /excluded\.last_verified_at > current_entitlement\.last_verified_at/);
  assert.match(upsert, /Verified subscription expiry is required for Pro access/);
  assert.match(profileSync, /stripe_customer_id = case/);
  assert.match(profileSync, /stripe_subscription_id = case/);
  assert.match(profileSync, /subscription_status = compatibility_status/);
  assert.match(schema, /excluded\.last_verified_at > current_entitlement\.last_verified_at/);
  assert.match(migration, /create or replace function public\.refresh_effective_subscription_profile/);
  assert.match(migration, /refresh_subscription_profile_after_entitlement/);
});

test('the shared Pro summary delegates its decision to the database entitlement predicate', async () => {
  const [store, predicate] = await Promise.all([
    source('src/lib/native-subscriptions/store.ts'),
    source('supabase/migrations/20261017100000_pro_saved_content_access.sql'),
  ]);
  assert.match(store, /rpc\("user_has_pro_access"/);
  assert.match(store, /canonicalProAccess === true/);
  const resolver = predicate.slice(predicate.indexOf('create or replace function public.user_has_pro_access'), predicate.indexOf('revoke all on function public.user_has_pro_access'));
  assert.match(resolver, /profile\.manual_pro_grant/);
  assert.match(resolver, /status in \('active', 'trialing', 'grace_period'\)/);
  assert.match(resolver, /current_period_end is not null[\s\S]*current_period_end > now\(\)/);
  assert.doesNotMatch(resolver, /profile\.is_pro|profile\.stripe_customer_id/);
});

test('legacy Pro flags are preflighted and provider snapshots cannot go backwards', async () => {
  const [foundation, accessMigration, auditQuery, schema] = await Promise.all([
    source('supabase/migrations/20261017090000_manual_pro_grant_foundation.sql'),
    source('supabase/migrations/20261017100000_pro_saved_content_access.sql'),
    source('supabase/operations/pro_entitlement_preflight.sql'),
    source('supabase/schema.sql'),
  ]);
  assert.match(foundation, /manual_pro_grant boolean not null default false/);
  assert.match(foundation, /new\.manual_pro_grant is distinct from old\.manual_pro_grant/);
  assert.match(accessMigration, /profile\.is_pro[\s\S]*profile\.manual_pro_grant/);
  assert.match(accessMigration, /current_period_end is null[\s\S]*raise exception/);
  assert.match(auditQuery, /CLASSIFY_LEGACY_PRO_FLAG/);
  assert.match(schema, /excluded\.last_verified_at > current_entitlement\.last_verified_at/);
});

test('web subscription presentation uses the same canonical server summary', async () => {
  const route = await source('src/app/api/stripe/subscription/route.ts');
  assert.match(route, /getSubscriptionSummary\(createAdminSupabaseClient\(\), user\.id\)/);
  assert.doesNotMatch(route, /stripe\.subscriptions\.(retrieve|list)/);
});

// Phase 04 behavioural coverage. SQL execution remains a separate local gate.
async function cancellationModules() {
 const ts=(await import('typescript')).default,vm=(await import('node:vm')).default;
 const load=async(path,mocks={})=>{const exports={};vm.runInNewContext(ts.transpileModule(await source(path),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process:{env:{ADMIN_SECRET_KEY:'test-admin'}},URLSearchParams,require:n=>{assert.ok(n in mocks,`Unexpected dependency ${n}`);return mocks[n];}});return exports;};
 const types=await load('src/lib/native-subscriptions/types.ts');
 const cancellation=await load('src/lib/native-subscriptions/cancellation.ts',{'./types':types,'@apple/app-store-server-library':await import('@apple/app-store-server-library')});
 return {load,cancellation,types};
}
const feedbackInput={id:'64000000-0000-4000-8000-000000000001',subscriptionId:'64000000-0000-4000-8000-000000000002',reason:'other',details:''};
test('cancellation feedback validates five reasons, optional text and exact limit',async()=>{
 const {cancellation:c}=await cancellationModules();
 for(const reason of c.CANCELLATION_REASONS){assert.ok(c.parseFeedback({...feedbackInput,reason}));assert.ok(c.parseFeedback({...feedbackInput,reason,details:'x'.repeat(1000)}));}
 for(const value of [null,[],{}, {...feedbackInput,id:'bad'},{...feedbackInput,reason:'discount'},{...feedbackInput,details:'x'.repeat(1001)}])assert.equal(c.parseFeedback(value),null);
});
test('Apple cancellation needs explicit verified matching notification and renewal evidence',async()=>{
 const {cancellation:c}=await cancellationModules();const input={notification:{notificationType:'DID_CHANGE_RENEWAL_STATUS',subtype:'AUTO_RENEW_DISABLED'},transaction:{originalTransactionId:'original',productId:'monthly',environment:'Sandbox',expiresDate:Date.now()+86400000},renewal:{originalTransactionId:'original',productId:'monthly',environment:'Sandbox',autoRenewStatus:0}};
 assert.equal(c.appleCancellationEvidence(input).source,'apple_renewal_disabled');
 for(const patch of [{renewal:null},{notification:{...input.notification,subtype:'AUTO_RENEW_ENABLED'}},{notification:{notificationType:'EXPIRED'}},{renewal:{...input.renewal,autoRenewStatus:undefined}},{renewal:{...input.renewal,originalTransactionId:'other'}},{renewal:{...input.renewal,environment:'Production'}}])assert.equal(c.appleCancellationEvidence({...input,...patch}),null);
});
test('membership uses one account-scoped joined snapshot; reactivation never schedules and failures are not empty',async()=>{
 const {cancellation:c}=await cancellationModules();
 const row={id:'sub',user_id:'owner',provider:'apple',plan:'monthly',status:'active',current_period_end:'2099-01-01T00:00:00Z',last_verified_at:'2026-11-12T12:00:00Z',auto_renews:true};
 const disabled={source:'apple_renewal_disabled',snapshot_verified_at:'2026-11-12T10:00:00Z',scheduled_end_at:row.current_period_end};
 let rows=[{subscription:row,evidence:disabled}],error=null; const calls=[];
 const auth={user:{id:'owner'},admin:{rpc:async(name,args)=>{calls.push([name,args]);return {data:rows,error};},from(){throw Error('split reads forbidden');}}};
 assert.equal((await c.membershipDetails(auth))[0].cancellation.state,'scheduled');
 assert.equal(calls.length,1);assert.equal(calls[0][0],'read_apple_membership_snapshot');assert.equal(calls[0][1].p_user_id,'owner');
 for(const evidence of [null,{...disabled,source:'apple_renewal_enabled'},{...disabled,source:'apple_terminal'},{...disabled,scheduled_end_at:'2000-01-01T00:00:00Z'}]){
  rows=[{subscription:row,evidence}];assert.equal((await c.membershipDetails(auth))[0].cancellation.state,'unknown');
 }
 for(const patch of [{status:'revoked'},{status:'expired'},{current_period_end:'2000-01-01T00:00:00Z'}]){
  rows=[{subscription:{...row,...patch},evidence:disabled}];assert.equal((await c.membershipDetails(auth))[0].cancellation.state,'unknown');
 }
 for(const provider of ['google','stripe']){rows=[{subscription:{...row,provider},evidence:disabled}];assert.equal((await c.membershipDetails(auth)).length,0);}
 error=Error('database read failed');await assert.rejects(c.membershipDetails(auth),/database read failed/);
});
test('feedback API uses authenticated ownership, receipt-only response, safe conflicts and admin-only reads',async()=>{
 const {load,cancellation}=await cancellationModules();let loggedIn=true,cookie='ordinary',calls=[],rpcError=null;
 const admin={rpc:async(name,args)=>{calls.push([name,args]);return {data:null,error:rpcError};},from(table){assert.equal(table,'subscription_cancellation_feedback');return {select(columns){assert.equal(columns,'request_id,subscription_id,reason,details,submitted_at,retain_until');return this;},gt(){return this;},order(){return this;},limit:async()=>({data:[{request_id:feedbackInput.id}],error:null})};}};
 const route=await load('src/app/api/native-subscriptions/cancellation-feedback/route.ts',{
 'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})}},
 'next/headers':{cookies:async()=>({get:()=>({value:cookie})})},'@/utils/supabase/admin':{createAdminSupabaseClient:()=>admin},
 '@/lib/native-subscriptions/auth':{authenticateNativeSubscriptionRequest:async()=>loggedIn?{user:{id:'owner'},admin}:null},
 '@/lib/native-subscriptions/cancellation':cancellation,'@/lib/native-subscriptions/route-response':{nativeSubscriptionErrorResponse:()=>({status:503})}});
 const request={json:async()=>({...feedbackInput,userId:'attacker'})};
 assert.equal((await route.GET()).status,403);assert.equal(calls.length,0);
 loggedIn=false;assert.equal((await route.POST(request)).status,401);loggedIn=true;
 assert.equal((await route.POST({json:async()=>null})).status,400);
 const result=await route.POST(request);assert.equal(result.body.receipt,feedbackInput.id);assert.equal(Object.keys(result.body).length,1);assert.deepEqual(Object.keys(calls[0][1]).sort(),['p_details','p_reason','p_request_id','p_subscription_id','p_user_id']);assert.equal(calls[0][1].p_user_id,'owner');assert.equal(calls[0][1].p_request_id,feedbackInput.id);assert.equal(calls[0][1].p_details,'');
 for(const [code,status] of [['23505',409],['42501',403],['other',503]]){rpcError={code,message:'private text must not escape'};const r=await route.POST(request);assert.equal(r.status,status);assert.doesNotMatch(JSON.stringify(r),/private text/);}
 cookie='test-admin';rpcError=null;const read=await route.GET();assert.equal(read.status,200);assert.equal(read.body.feedback[0].request_id,feedbackInput.id);assert.equal(calls.at(-1)[0],'cleanup_subscription_cancellation_feedback');
});
test('store sends snapshot and evidence in one RPC without changing canonical upsert signature',async()=>{
 const {load,types}=await cancellationModules();const store=await load('src/lib/native-subscriptions/store.ts',{'./types':types});const calls=[];
 const input={userId:'owner',provider:'apple',providerSubscriptionId:'sub',status:'active',currentPeriodEnd:'2099-01-01T00:00:00Z',environment:'sandbox',lastVerifiedAt:'2026-11-12T00:00:00Z',cancellationEvidence:{source:'apple_renewal_disabled',scheduledEndAt:null}};
 assert.equal(await store.upsertSubscriptionEntitlement({rpc:async(...args)=>{calls.push(args);return {data:'id',error:null};}},input),'id');
 assert.equal(calls.length,1);assert.equal(calls[0][0],'upsert_subscription_with_cancellation_evidence');assert.equal(calls[0][1].p_snapshot.p_user_id,'owner');assert.equal(calls[0][1].p_evidence.source,'apple_renewal_disabled');
});
test('Apple selected management checks ownership; legacy Stripe management remains unchanged',async()=>{
 const {load,cancellation}=await cancellationModules();let selected=null,created=[],ownedCalls=[];
 const admin={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{stripe_customer_id:'cus_owned'},error:null})})};
 const route=await load('src/app/api/native-subscriptions/manage/route.ts',{
 'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},
 '@/lib/native-subscriptions/cancellation':{...cancellation,ownedSubscription:async(auth,id)=>{ownedCalls.push([auth.user.id,id]);return selected;}},
 '@/lib/native-subscriptions/auth':{authenticateNativeSubscriptionRequest:async()=>({user:{id:'owner'},admin})},
 '@/lib/native-subscriptions/config':{DAD_HEALTH_ANDROID_PACKAGE:'test'},'@/lib/native-subscriptions/route-response':{nativeSubscriptionErrorResponse:()=>({status:503})},
 '@/lib/native-subscriptions/store':{getSubscriptionSummary:async()=>({isPro:true,primaryProvider:'stripe'})},
 '@/lib/site-url':{getSiteUrl:()=> 'https://www.dadhealth.co.uk'},'@/lib/stripe/server':{getStripe:()=>({billingPortal:{sessions:{create:async args=>{created.push(args);return {url:'https://billing.stripe.com/test'};}}}})}});
 const request={json:async()=>({subscriptionId:feedbackInput.subscriptionId})};assert.equal((await route.POST(request)).status,404);
 selected={provider:'apple'};assert.match((await route.POST(request)).body.url,/apps.apple.com/);
 selected={provider:'stripe',provider_account_id:'cus_owned',provider_subscription_id:'sub_owned'};assert.equal((await route.POST(request)).status,404);assert.equal(created.length,0);
 assert.equal((await route.POST({json:async()=>({})})).status,200);
 assert.equal(JSON.stringify(created[0]),JSON.stringify({customer:'cus_owned',return_url:'https://www.dadhealth.co.uk/pricing'}));
 assert.ok(ownedCalls.every(x=>x[0]==='owner'));
});

test('legacy Stripe and Google writes retain the original RPC and payload',async()=>{
 const {load,types}=await cancellationModules();const store=await load('src/lib/native-subscriptions/store.ts',{'./types':types});
 for(const provider of ['stripe','google']){const calls=[];const input={userId:'owner',provider,providerSubscriptionId:'sub',status:'active',currentPeriodEnd:'2099-01-01T00:00:00Z',environment:'production',lastVerifiedAt:'2026-11-12T00:00:00Z'};
 await store.upsertSubscriptionEntitlement({rpc:async(...args)=>{calls.push(args);return {data:'id',error:null};}},input);
 assert.equal(calls[0][0],'upsert_subscription_entitlement');assert.equal(calls[0][1].p_provider,provider);assert.equal(calls[0][1].p_evidence,undefined);assert.equal(calls[0][1].p_current_period_end,input.currentPeriodEnd);}
});
async function appleHandlerHarness(){
 const {load,cancellation}=await cancellationModules();const h={writes:[],failed:0,completed:0,duplicate:false};
 h.verified={notification:{notificationUUID:'event',notificationType:'DID_CHANGE_RENEWAL_STATUS',subtype:'AUTO_RENEW_DISABLED',signedDate:2000,data:{}},transaction:{originalTransactionId:'original',transactionId:'tx',productId:'monthly',environment:'Sandbox',appAccountToken:'owner',expiresDate:Date.now()+86400000},renewal:{originalTransactionId:'original',productId:'monthly',environment:'Sandbox',autoRenewStatus:0},environment:'sandbox'};
 h.route=await load('src/app/api/native-subscriptions/notifications/apple/route.ts',{
 'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status??200})}},
 '@/lib/native-subscriptions/cancellation':cancellation,
 '@/lib/native-subscriptions/apple':{verifyAppleNotification:async()=>h.verified,appleEntitlementInput:(owner,verified,renewal,status,lastVerifiedAt)=>({userId:owner,lastVerifiedAt,status:verified.transaction.revocationDate?'revoked':'active'})},
 '@/lib/native-subscriptions/provider-events':{claimProviderEvent:async()=>h.duplicate?null:'claim',completeProviderEvent:async()=>h.completed++,failProviderEvent:async()=>h.failed++},
 '@/lib/native-subscriptions/store':{findSubscriptionEntitlement:async()=>({user_id:'owner'}),upsertSubscriptionEntitlement:async(admin,input)=>h.writes.push(input)},
 '@/utils/supabase/admin':{createAdminSupabaseClient:()=>({})}});
 h.call=()=>h.route.POST({json:async()=>({signedPayload:'mock-signed-payload'})});return h;
}
for(const signedDate of [undefined,NaN,0,-1])test(`Apple handler rejects invalid signing date ${signedDate} before upsert`,async()=>{const h=await appleHandlerHarness();h.verified.notification.signedDate=signedDate;assert.equal((await h.call()).status,500);assert.equal(h.writes.length,0);assert.equal(h.failed,1);assert.equal(h.completed,0);});
test('Apple handler preserves provider time for stale notifications and skips duplicate claims',async()=>{const h=await appleHandlerHarness();await h.call();assert.equal(h.writes[0].lastVerifiedAt,new Date(2000).toISOString());assert.equal(h.writes[0].cancellationEvidence.source,'apple_renewal_disabled');h.verified.notification.signedDate=1000;await h.call();assert.equal(h.writes[1].lastVerifiedAt,new Date(1000).toISOString());h.duplicate=true;await h.call();assert.equal(h.writes.length,2);});
for(const outcome of ['reactivated','revoked'])test(`Apple ${outcome} forwards explicit reactivation or terminal snapshot`,async()=>{const h=await appleHandlerHarness();if(outcome==='reactivated'){h.verified.notification.subtype='AUTO_RENEW_ENABLED';h.verified.renewal.autoRenewStatus=1;}else h.verified.transaction.revocationDate=1;await h.call();assert.deepEqual(h.writes[0].cancellationEvidence ? {...h.writes[0].cancellationEvidence} : null,{source:outcome==='reactivated'?'apple_renewal_enabled':'apple_terminal',scheduledEndAt:null});});

test('ordinary Apple verification supplies no reactivation evidence; explicit enabled event requires matching verified renewal',async()=>{
 const h=await appleHandlerHarness();
 h.verified.notification.subtype='AUTO_RENEW_ENABLED';
 h.verified.renewal.autoRenewStatus=1;
 await h.call(); assert.deepEqual({...h.writes.at(-1).cancellationEvidence},{source:'apple_renewal_enabled',scheduledEndAt:null});
 h.verified.renewal.originalTransactionId='wrong';
 await h.call(); assert.equal(h.writes.at(-1).cancellationEvidence,null);
 const {load,types}=await cancellationModules(); const store=await load('src/lib/native-subscriptions/store.ts',{'./types':types});
 const calls=[]; const admin={rpc:async(...args)=>{calls.push(args);return {data:'sub',error:null};}};
 await store.upsertSubscriptionEntitlement(admin,{userId:'owner',provider:'apple',providerSubscriptionId:'sub',status:'active',currentPeriodEnd:'2099-01-01T00:00:00Z',environment:'sandbox',autoRenews:true});
 assert.equal(calls[0][1].p_evidence,null);
 assert.equal(calls[0][1].p_snapshot.p_auto_renews,true);
});

test('delayed enabled notification preserves provider signing time independent of newer restore time',async()=>{
 const h=await appleHandlerHarness();
 h.verified.notification.signedDate=3000;await h.call();
 h.verified.notification.subtype='AUTO_RENEW_ENABLED';h.verified.renewal.autoRenewStatus=1;
 h.verified.notification.signedDate=4000;await h.call();
 assert.equal(h.writes[1].lastVerifiedAt,new Date(4000).toISOString());
 assert.equal(h.writes[1].cancellationEvidence.source,'apple_renewal_enabled');
 // The SQL regression supplies a canonical restore at 12000 and proves the
 // 4000 event advances evidence without changing the 12000 entitlement.
});
test('verified Apple expiry keeps a terminal provider watermark',async()=>{
 const h=await appleHandlerHarness();h.verified.notification.notificationType='EXPIRED';h.verified.notification.data.status=2;
 await h.call();assert.equal(h.writes[0].cancellationEvidence.source,'apple_terminal');
});
