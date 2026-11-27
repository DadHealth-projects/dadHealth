import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
class PrivacyError extends Error { constructor(code) { super(code); this.code = code; } }
const owner = '11111111-1111-4111-8111-111111111111';
const person = '33333333-3333-4333-8333-333333333333';
const eventId = n => `22222222-2222-4222-8222-${String(n).padStart(12,'0')}`;
const profile = { uuid: person, distinct_ids: [owner, 'legacy-browser-id'], properties: { note: null, name: 'Fixture é' }, created_at: null };
function harness(count = 205) {
  const state = { owner, ready: false, revision: 0, state: { phase: 'profiles', cutoff: '2026-11-21T00:00:00.123Z', startedAt: '2026-11-21T00:01:00Z' } };
  const rows = Array.from({length:count}, (_,i) => [eventId(i+1),'$pageview','2026-11-20T00:00:00.000Z', i%2 ? owner : 'legacy-browser-id', { text: 'é\nline', nullable: null }]);
  const h = { state, rows, stored: new Map(), requests: [], checkpoints: [], fail: false, lost: false, changed: false, profiles: [profile] };
  h.env = {ANALYTICS_POSTHOG_API_HOST:'https://eu.posthog.com',POSTHOG_PROJECT_ID:'145008',POSTHOG_API_KEY:'fixture'};
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/privacy/export-analytics.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:id=>id==='node:crypto'?require(id):id==='./auth'?{PrivacyError}:{checkpoint:async(_a,_o,p)=>h.checkpoints.push(p)},Date,URL,AbortSignal,fetch,
     process:{env:h.env}});
  const admin = {rpc:async(name,args)=>{
    if (name==='begin_account_export_analytics') return {data:structuredClone(state)};
    if (name==='save_account_export_analytics') {
      assert.equal(args.p_revision,state.revision);
      args.p_records.forEach(r=>h.stored.set(r.id,structuredClone(r)));
      state.state=structuredClone(args.p_state); state.revision++;
      if(h.lost) {h.lost=false;throw Error('lost DB response');}
      return {data:{revision:state.revision}};
    }
    if (name==='restart_account_export_analytics') {
      assert.equal(args.p_revision,state.revision);
      if((state.state.rebuilds??0)>=2) return {error:{code:'55000'}};
      h.stored.clear();state.state={phase:'profiles',cutoff:state.state.cutoff,startedAt:state.state.startedAt,rebuilds:(state.state.rebuilds??0)+1};
      state.revision++;return {data:{revision:state.revision,state:structuredClone(state.state)}};
    }
    assert.equal(name,'finish_account_export_analytics');state.ready=true;return {data:true};
  }};
  const transport = async(url,init)=> {
    h.requests.push({url,init});
    if(h.fail) return Response.json({}, {status:503});
    if(url.includes('/persons/')) {
      if(h.profilePages) {
        const second=url.includes('cursor=second');
        return Response.json({results:h.profilePages[second?1:0],next:second?null:`https://eu.posthog.com/api/projects/145008/persons/?distinct_id=${owner}&cursor=second`});
      }
      return Response.json({results:h.profiles,next:h.next??null});
    }
    throw Error('No interactive query fallback is permitted');
  };
  const readEvents=async({cursor,limit,aliases,cutoff})=>{
    assert.equal(limit,101);assert.ok(aliases.includes(owner));assert.equal(cutoff,state.state.cutoff);
    let result=rows.filter(r=>!cursor||r[0]>cursor).slice(0,101);
    if(h.changed && state.state.phase==='verify') result=result.slice(1);
    return {results:result,is_cached:false};
  };
  h.run=(blocked=false)=>exports.captureRemoteAnalytics(admin,{id:'fixture',user_id:owner,lease_token:'lease',attempts:1},transport,blocked?undefined:readEvents);
  return h;
}
test('all remote pages and legacy aliases survive restart with original nulls and values',async()=>{
  const h=harness();let turns=0;while(!await h.run()) assert.ok(++turns<10);
  assert.equal(h.stored.size,205);assert.equal(h.state.state.count,205);assert.equal(h.state.state.verifyCount,205);
  assert.equal(h.stored.get(eventId(1)).properties.nullable,null);
  assert.equal(h.state.state.profiles[0].providerProfile.properties.name,'Fixture é');
  assert.ok(h.checkpoints.length>0);assert.ok(h.checkpoints.every(p=>p.attempts===0));
  const calls=h.requests.length;assert.equal(await h.run(),true);assert.equal(h.requests.length,calls);
});
test('lost page acknowledgement resumes saved revision rather than duplicating records',async()=>{
  const h=harness(3);h.lost=true;await assert.rejects(h.run());
  while(!await h.run()) {} assert.equal(h.stored.size,3);assert.equal(h.state.ready,true);
});
test('provider failure never marks complete; later successful reads resume',async()=>{
  const h=harness(1);h.fail=true;await assert.rejects(h.run(),e=>e.code==='analytics_export_provider_unavailable');
  assert.equal(h.state.ready,false);h.fail=false;while(!await h.run()) {} assert.equal(h.stored.size,1);
});
test('changed events rebuild from original cutoff, then complete only after a stable read',async()=>{
  const h=harness(3);await h.run();h.changed=true;
  await h.run();assert.equal(h.state.ready,false);assert.equal(h.state.state.rebuilds,1);
  h.changed=false;while(!await h.run()){}assert.equal(h.stored.size,3);
});
test('profiles unrelated to owner and hostile pagination URLs are rejected',async()=>{
  const h=harness(1);h.profiles=[{...profile,distinct_ids:['other']}];
  await assert.rejects(h.run(),e=>e.code==='analytics_export_identity_unverified');
  h.profiles=[profile];h.next='https://attacker.invalid/';await assert.rejects(h.run(),e=>e.code==='analytics_export_pagination_invalid');
  assert.ok(h.requests.every(r=>r.url.startsWith('https://eu.posthog.com/')));
});
test('empty remote dataset is complete only after both event and profile verification',async()=>{
  const h=harness(0);h.profiles=[];assert.equal(await h.run(),false);assert.equal(h.state.ready,false);
  while(!await h.run()){}assert.equal(h.state.state.count,0);
});
test('conflicting duplicate event identifiers fail rather than omit data',async()=>{
  const h=harness(2);h.rows[1][0]=h.rows[0][0];
  await assert.rejects(h.run(),e=>e.code==='analytics_export_changed');assert.equal(h.state.ready,false);
});

test('multiple profile pages and changing profiles cannot silently omit information',async()=>{
 const h=harness(0);h.profilePages=[[profile],[{...profile,uuid:'66666666-6666-4666-8666-666666666666'}]];
 assert.equal(await h.run(),false);assert.equal(h.state.state.profiles.length,2);
 h.profilePages[1][0]={...h.profilePages[1][0],properties:{changed:true}};
 while(!h.state.state.rebuilds) await h.run();
 assert.equal(h.state.ready,false);while(!await h.run()){}
 assert.equal(h.state.state.profiles[1].properties.changed,true);
});

test('production without a confirmed bulk adapter fails closed and never calls the interactive query API',async()=>{
 const h=harness();await assert.rejects(h.run(true),e=>e.code==='analytics_export_capability_required');
 assert.equal(h.requests.length,0);assert.equal(h.state.ready,false);
});

test('profile page acknowledgement survives restart without replaying earlier pages',async()=>{
 const h=harness(0);h.profilePages=[[profile],[{...profile,uuid:'66666666-6666-4666-8666-666666666666'}]];
 h.lost=true;await assert.rejects(h.run());
 assert.match(h.state.state.profileCursor,/cursor=second/);
 const before=h.requests.length;await h.run();assert.match(h.requests[before].url,/cursor=second/);
 while(!await h.run()){}assert.equal(h.state.state.profiles.length,2);
});

test('continuously changing remote data exhausts bounded rebuilds without finalization',async()=>{
 const h=harness(3);h.changed=true;
 await assert.rejects(async()=>{for(let i=0;i<20;i++)await h.run();},e=>e.code==='analytics_export_storage_unavailable');
 assert.equal(h.state.state.rebuilds,2);assert.equal(h.state.ready,false);
});
test('wrong operation owner is rejected before any provider access',async()=>{
 const h=harness();h.state.owner=person;await assert.rejects(h.run(),e=>e.code==='analytics_export_owner_mismatch');assert.equal(h.requests.length,0);
});

test('verified primary capability cannot certify an export missing retained legacy data',async()=>{
 const h=harness();h.env.POSTHOG_OWNER_SQL_EXPORTS_VERIFIED='true';
 await assert.rejects(h.run(true),e=>e.code==='analytics_export_legacy_project_required');
 assert.equal(h.requests.length,0);assert.equal(h.state.ready,false);
});
test('wrong configured project is rejected before profile access',async()=>{
 const h=harness();h.env.POSTHOG_PROJECT_ID='162656';
 await assert.rejects(h.run(),e=>e.code==='analytics_export_configuration_required');
 assert.equal(h.requests.length,0);
});
test('file reader targets primary project and never reuses a legacy run key',async()=>{
 const exports={};const input={aliases:[owner],cutoff:'2026-11-21T00:00:00Z',limit:101,pass:'events:0'};
 const env={POSTHOG_OWNER_SQL_EXPORTS_VERIFIED:'true',ANALYTICS_POSTHOG_API_HOST:'https://eu.posthog.com',POSTHOG_PROJECT_ID:'145008',POSTHOG_API_KEY:'fixture'};
 vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/privacy/posthog-export-reader.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,require:id=>id==='node:crypto'?require(id):{PrivacyError},process:{env},Date,URL,AbortSignal,fetch});
 const oldKey=require('node:crypto').createHash('sha256').update(JSON.stringify(input)).digest('hex');let saved;const requests=[];
 await exports.readPosthogExportPage(input,{key:oldKey,id:person},async r=>{saved=r;},async(url,init)=>{requests.push({url,init});return Response.json({id:person});});
 assert.equal(requests[0].url,'https://eu.posthog.com/api/projects/145008/file_download_batch_exports/');
 assert.equal(requests[0].init.method,'POST');assert.notEqual(saved.key,oldKey);
 env.POSTHOG_PROJECT_ID='162656';await assert.rejects(exports.readPosthogExportPage(input,undefined,async()=>{},async()=>{throw Error('must not send');}),e=>e.code==='analytics_export_configuration_required');
});
