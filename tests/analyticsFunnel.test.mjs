import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(path,mocks={}){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:id=>id in mocks?mocks[id]:require(id),Date,Buffer,process,Request,Response,AbortSignal,fetch,console});return exports;}
const contract=load('src/lib/analytics/contract.ts');
const api=load('src/lib/analytics/service.ts',{'./contract':contract});
const billing=load('src/lib/analytics/billing.ts',{'./contract':contract});
const at='2026-11-20T12:00:00.000Z';
const previous={user_id:'owner',provider:'apple',environment:'sandbox',provider_subscription_id:'subscription',status:'trialing',trial_end:at,auto_renews:true,last_verified_at:'2026-11-19T12:00:00.000Z'};
const input={userId:'owner',provider:'apple',environment:'sandbox',providerSubscriptionId:'subscription',status:'active',latestTransactionId:'paid-transaction',autoRenews:true,lastVerifiedAt:at};
test('billing conversion requires verified positive paid transition; active, zero-cost, manual and prior unrelated environments do not qualify',()=>{
 assert.equal(billing.billingFacts(input,previous).length,0);
 const paid={verified:true,amount:5990,paidAt:at,transactionId:'paid-transaction'};
 assert.equal(billing.billingFacts(input,previous,paid)[0].event,'trial_converted');
 for(const p of [{...paid,amount:0},{...paid,amount:NaN},{...paid,verified:false},{...paid,transactionId:'other'},{...paid,paidAt:'2026-11-19T12:00:00.000Z'}])assert.equal(billing.billingFacts(input,previous,p).length,0);
 assert.equal(billing.billingFacts(input,{...previous,environment:'production'},paid).length,0);
 assert.equal(billing.billingFacts(input,{...previous,status:'active'},paid).length,0);
});
test('verified renewal cancellation is distinct from expiry and has no invented reason',()=>{
 const cancelled=billing.billingFacts({...input,status:'trialing',autoRenews:false},previous);
 assert.equal(cancelled[0].event,'trial_cancelled');assert.equal(cancelled[0].properties.reason,'unavailable');
 assert.equal(billing.billingFacts({...input,autoRenews:false},{...previous,status:'active'})[0].event,'subscription_cancelled');
 assert.equal(billing.billingFacts({...input,status:'expired',autoRenews:false},previous).length,0);
 assert.equal(billing.billingFacts({...input,autoRenews:false},{...previous,auto_renews:false}).length,0);
});
test('provider replay/order and environment produce stable isolated dedupe keys',()=>{
 const event={...input,status:'trialing',trialFacts:{transactionId:'trial',startedAt:'2026-11-19T12:00:00.000Z',endsAt:at}};
 const first=billing.billingFacts(event,null)[0];assert.equal(first.event,'trial_started');
 assert.equal(billing.billingFacts(event,null)[0].key,first.key);
 assert.notEqual(billing.billingFacts({...event,environment:'production'},null)[0].key,first.key);
 assert.equal(billing.billingFacts(event,{...previous,last_verified_at:at}).length,0);
 assert.equal(billing.billingFacts({...event,lastVerifiedAt:'2026-11-18T12:00:00.000Z'},previous).length,0);
});
test('background billing without attributable consent never touches analytics database; provider failure never rejects processing',async()=>{
 const admin={rpc:async()=>{throw Error('outage');}};
 assert.equal((await billing.collectVerifiedBilling(admin,input,previous,null)).suppressed,true);
 const c={owner:'owner',consent:'fixture',secretHash:'fixture',validFrom:'2026-11-18T00:00:00Z',validUntil:'2026-11-21T00:00:00Z'};
 assert.equal((await billing.collectVerifiedBilling(admin,{...input,autoRenews:false},previous,c)).collected,0);
 assert.equal((await billing.collectVerifiedBilling(admin,input,previous,{...c,owner:'other'})).suppressed,true);
});
test('worker rejects poisoned private properties, invalid dates and unknown server facts before network',async()=>{
 let calls=0;const send=async()=>{calls++;throw Error('must not send');};
 const row={id:'11111111-1111-4111-8111-111111111111',event:'streak_reached',properties:{milestone:7},occurred_at:new Date().toISOString(),lease_until:new Date(Date.now()+60000).toISOString()};
 for(const bad of [{...row,properties:{milestone:7,email:'private'}},{...row,occurred_at:'invalid'},{...row,event:'private_note'},{...row,properties:{milestone:8}}])assert.equal(await api.deliver(bad,send),'failed');
 assert.equal(calls,0);assert.equal(contract.permittedProperties('streak_reached',{milestone:7}),false);assert.equal(contract.permittedProperties('streak_reached',{milestone:7},'server'),true);
});
test('capture requires trusted IP and revocation remains independently rate limited',async()=>{
 process.env.ANALYTICS_RATE_SECRET='fixture';delete process.env.ANALYTICS_TRUST_VERCEL_IP;
 const calls=[];const admin={rpc:async(_n,a)=>{calls.push(a);return {data:true};}};
 const req=new Request('https://fixture.invalid');
 await assert.rejects(api.rateLimit(admin,req,{action:'capture'}),e=>e.code==='configuration_required');
 await api.rateLimit(admin,req,{action:'withdraw',consent:'33333333-3333-4333-8333-333333333333',secret:'22222222-2222-4222-8222-22222222222233333333-3333-4333-8333-333333333333'});assert.equal(calls[0].p_limit,300);
 process.env.ANALYTICS_TRUST_VERCEL_IP='true';
 await api.rateLimit(admin,new Request('https://fixture.invalid',{headers:{'x-vercel-forwarded-for':'192.0.2.1'}}),{action:'capture'});
 assert.equal(calls[1].p_limit,120);assert.notEqual(calls[0].p_key,calls[1].p_key);
});

test('Apple adapter carries signed positive transaction evidence without equating active access with payment',()=>{
 const types=load('src/lib/native-subscriptions/types.ts');
 const apple=load('src/lib/native-subscriptions/apple.ts',{'./types':types,'./config':{DAD_HEALTH_BUNDLE_ID:'fixture.bundle',requireKnownAppleProduct:()=> 'annual'}});
 const transaction={bundleId:'fixture.bundle',originalTransactionId:'subscription',transactionId:'paid-transaction',productId:'fixture',purchaseDate:Date.now()-1000,expiresDate:Date.now()+86400000,price:5990};
 const input=apple.appleEntitlementInput('owner',{transaction,environment:'sandbox'});
 assert.equal(input.verifiedPayment.amount,5990);assert.equal(input.verifiedPayment.verified,true);
 assert.equal(apple.appleEntitlementInput('owner',{transaction:{...transaction,price:undefined},environment:'sandbox'}).verifiedPayment,undefined);
 assert.equal(apple.appleEntitlementInput('owner',{transaction:{...transaction,price:0},environment:'sandbox'}).verifiedPayment,undefined);
 assert.equal(apple.appleEntitlementInput('owner',{transaction:{...transaction,revocationDate:Date.now()},environment:'sandbox'}).verifiedPayment,undefined);
});

test('Google and Stripe payment adapters require verified positive matched orders; partial/manual invoices do not qualify',()=>{
 const evidence = load('src/lib/analytics/provider-evidence.ts', {
  '../stripe/verified-fields': load('src/lib/stripe/verified-fields.ts'),
});
 const order={orderId:'order',purchaseToken:'token',state:'PROCESSED',total:{units:'5',nanos:990000000},orderHistory:{processedEvent:{eventTime:at}},lineItems:[{subscriptionDetails:{servicePeriodStartTime:at}}]};
 assert.equal(evidence.googlePaidEvidence(order,'token','order').amount,5.99);
 assert.equal(evidence.googlePaidEvidence(order,'other','order'),undefined);
 assert.equal(evidence.googlePaidEvidence({...order,state:'CANCELLED'},'token','order'),undefined);
 assert.equal(evidence.googlePaidEvidence({...order,total:{units:'0'}},'token','order'),undefined);
 const invoice={id:'invoice',subscription:'sub_fixture',status:'paid',amount_paid:599,status_transitions:{paid_at:Date.parse(at)/1000},lines:{has_more:false,data:[{type:'subscription',proration:false,period:{start:Date.parse(at)/1000}}]}};
 assert.equal(evidence.stripePaidEvidence(invoice,'sub_fixture').servicePeriodStart,at);
 assert.equal(evidence.stripePaidEvidence({...invoice,paid_out_of_band:true},'sub_fixture'),undefined);
 assert.equal(evidence.stripePaidEvidence(invoice,'other'),undefined);
 assert.equal(evidence.stripePaidEvidence({...invoice,amount_paid:0},'sub_fixture'),undefined);
 assert.equal(evidence.stripePaidEvidence({...invoice,lines:{...invoice.lines,has_more:true}},'sub_fixture').servicePeriodStart,undefined);
});

test('paid-period evidence recovers conversion after an active snapshot arrives first, without counting a later renewal',()=>{
 const paid={verified:true,amount:5990,paidAt:at,servicePeriodStart:at,transactionId:'paid-transaction'};
 const alreadyActive={...previous,status:'active'};
 assert.equal(billing.billingFacts(input,alreadyActive,paid)[0].event,'trial_converted');
 assert.equal(billing.billingFacts(input,alreadyActive,{...paid,servicePeriodStart:'2026-12-20T12:00:00Z'}).length,0);
 assert.equal(billing.billingFacts(input,alreadyActive,paid)[0].key,billing.billingFacts(input,previous,paid)[0].key);
});
