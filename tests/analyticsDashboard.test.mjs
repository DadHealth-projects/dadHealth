import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboardDefinition,provision} from '../scripts/analytics-dashboard.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const definition=dashboardDefinition();
test('dashboard uses actual events; totals and accounts are distinct; billing environment filters only billing steps',()=>{
 const source=readFileSync('src/lib/analytics/contract.ts','utf8');
 const funnel=definition.panels[0].query.source;
 assert.equal(funnel.kind,'FunnelsQuery');assert.equal(funnel.series.length,6);
 for(const series of funnel.series){assert.ok(source.includes(series.event));assert.equal(series.math,'dau');}
 assert.equal(funnel.series[0].properties,undefined);assert.equal(funnel.series[4].properties[0].value[0],'production');
 const text=JSON.stringify(definition);assert.match(text,/unique_accounts/);assert.match(text,/event_total/);assert.match(text,/anonymous_identities/);
 assert.match(definition.description,/not all registered accounts/);assert.match(definition.description,/Purchases without trials/);
 assert.doesNotMatch(text,/offer_accepted/);
});
test('opaque test account and sandbox filters validate; arbitrary text cannot enter queries',()=>{
 assert.throws(()=>dashboardDefinition({account:"a' OR 1=1"}));assert.throws(()=>dashboardDefinition({environment:'madeup'}));
 const d=dashboardDefinition({account:'00000000-0000-4000-8000-000000000001',environment:'sandbox'});
 assert.match(d.panels[0].query.source.properties[0].key,/distinct_id = '0000/);
 assert.equal(d.panels[0].query.source.series[5].properties[0].value[0],'sandbox');
});
test('explicit provisioning uses existing project and repeat run does not duplicate dashboards/insights',async()=>{
 const dashboards=[],insights=[],calls=[];
 async function request(url,init){const path=new URL(url).pathname;calls.push([path,init.method]);const body=init.body?JSON.parse(init.body):null;let data;
  if(init.method==='GET')data={results:path.endsWith('/dashboards/')?dashboards:insights,next:null};
  else if(path.endsWith('/dashboards/')){data={...body,id:7};dashboards.push(data);}
  else if(init.method==='POST'){data={...body,id:insights.length+1};insights.push(data);}
  else {const id=Number(path.split('/').filter(Boolean).at(-1));data=Object.assign(insights.find(i=>i.id===id),body);}
  return {ok:true,json:async()=>data};
 }
 const options={host:'https://eu.posthog.com',project:'123',token:'fixture',request};
 await provision(definition,options);await provision(definition,options);
 assert.equal(dashboards.length,1);assert.equal(insights.length,definition.panels.length);
 assert.ok(calls.every(([p])=>p.startsWith('/api/projects/123/')));
 assert.ok(calls.every(([p])=>!p.includes('retention')&&!p.includes('capture')));
 await assert.rejects(()=>provision(definition,{...options,host:'https://untrusted.invalid'}));
});
test('backend youngest saved age mapping preserves missing and unknown values',()=>{
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/familyAges.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
 for(const [value,expected] of [[[],null],[null,null],[['unknown'],null],[['teen_12_plus','toddler_0_4'],'toddler'],[['adult_18_plus'],'teen']])assert.equal(exports.youngestChildBand(value),expected);
 const mobile={};vm.runInNewContext(ts.transpileModule(readFileSync('../dadhealth-mobile/lib/onboarding.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:mobile});
 const bands=['toddler_0_4','primary_5_11','teen_12_plus','adult_18_plus'];
 for(let mask=0;mask<16;mask++){const values=bands.filter((_,i)=>mask&(1<<i));assert.equal(exports.youngestChildBand(values),mobile.youngestChildBand(values));}
});
