import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import ts from 'typescript';import {readFileSync} from 'node:fs';
import { createRequire } from 'node:module';
import { readFile, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const require = createRequire(import.meta.url);
function load(path,deps={},extras={}){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Buffer,Date,URL,AbortSignal,Request,Response,ReadableStream,TextEncoder,process:{env:{PRIVACY_PUBLIC_ORIGIN:'https://fixture.invalid'},cwd:()=>process.cwd()},require:id=>{assert.ok(id in deps,id);return deps[id];},...extras});return exports;}
const pdf = load('src/lib/privacy/export-pdf.ts',Object.fromEntries(
 ['pdfkit','stream-json','node:stream','node:stream/promises','node:fs','node:fs/promises','node:path','node:os','node:timers/promises']
 .map(id=>[id,['pdfkit','stream-json'].includes(id)?{default:require(id)}:require(id)])));
const catalogue=load('src/lib/privacy/export-catalogue.ts');
class PrivacyError extends Error{constructor(code){super(code);this.code=code;}}
const payload=()=>({formatVersion:1,generatedAt:'2026-11-18T10:00:00Z',fieldExplanations:{null:'No value'},sections:{journal_entries:[{id:'one',content:'fixture',prompt:null}]}});
function harness(){const h={sent:[],calls:[],capture:true,authorize:{destination:'verified@example.invalid'},record:true,payload:payload()};const admin={rpc:async(name,args)=>{h.calls.push(name);return {data:name==='read_account_export_chunk'?{bytes:Buffer.byteLength(JSON.stringify(h.payload)),expiresAt:'2026-11-19T10:00:00Z'}:name==='capture_account_export'?h.capture:name==='authorize_account_export_send'?h.authorize:h.record,error:null};},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{payload:h.payload,expires_at:'2026-11-19T10:00:00Z'},error:null})})})})};const api=load('src/lib/privacy/export.ts',{'@/lib/email/resend':{sendEmail:async input=>{h.sent.push(input);return {id:'message-1'};}},'./auth':{PrivacyError},'./export-analytics':{captureRemoteAnalytics:async()=>{if(h.remoteError)throw new PrivacyError('analytics_export_provider_unavailable');return h.remoteReady!==false;}},'./export-catalogue':catalogue,'./export-pdf':pdf,'node:fs/promises':require('node:fs/promises'),'node:crypto':require('node:crypto'),'./operations':{checkpoint:async(_a,_o,patch)=>{h.calls.push('checkpoint');h.presentation=patch.checkpoint.exportPresentation;}}});return {h,admin,api,op:{id:'fixture-id',lease_token:'lease',handoff_at:null,checkpoint:{}}};}
test('JSON attachment preserves saved values and nulls',()=>{const a=catalogue.exportAttachment(payload());assert.deepEqual(JSON.parse(Buffer.from(a.content,'base64').toString()),payload());});
test('selected remote export pending or unavailable never authorizes email, even after rollout is disabled',async()=>{
 const {h,api,admin,op}=harness();op.checkpoint.remoteAnalyticsExport=1;h.remoteReady=false;
 await api.processExport(admin,op);assert.deepEqual(h.calls,['capture_account_export']);assert.equal(h.sent.length,0);
 h.remoteError=true;await assert.rejects(api.processExport(admin,op),e=>e.code==='analytics_export_provider_unavailable');
 assert.equal(h.calls.includes('authorize_account_export_send'),false);
});
test('handed-off exports retain original bytes without recapturing remote data',async()=>{
 const {h,api,admin,op}=harness();op.handoff_at=new Date().toISOString();op.checkpoint.remoteAnalyticsExport=1;h.remoteError=true;
 await api.processExport(admin,op);assert.equal(h.sent.length,1);assert.equal(h.sent[0].attachments.length,1);
 assert.equal(h.sent[0].attachments[0].filename,'dad-health-data.json');
});
test('encoded message budget switches large data to private link',()=>{assert.equal(catalogue.exportAttachment({text:'x'.repeat(5_000_000)}),null);assert.ok(catalogue.exportAttachment({text:'small'}));});
test('failed or missing captured section container is never sent as empty export',async()=>{const {h,api,admin,op}=harness();h.payload={formatVersion:1,generatedAt:'2026-11-18T10:00:00Z'};await assert.rejects(api.processExport(admin,op));assert.equal(h.sent.length,0);});
test('email authorization denial sends nothing',async()=>{const {h,api,admin,op}=harness();h.authorize=null;await api.processExport(admin,op);assert.equal(h.sent.length,0);});
test('export uses rechecked address and stable provider idempotency key',async()=>{const {h,api,admin,op}=harness();await api.processExport(admin,op);assert.equal(h.sent[0].to,'verified@example.invalid');assert.equal(h.sent[0].idempotencyKey,'privacy-export/fixture-id');assert.deepEqual(h.calls,['capture_account_export','read_account_export_chunk','checkpoint','authorize_account_export_send','record_privacy_email_result']);});
test('large email contains authenticated URL and exact expiry',async()=>{const {h,api,admin,op}=harness();h.payload.sections.large='x'.repeat(5_000_000);await api.processExport(admin,op);assert.equal(h.sent[0].attachments,undefined);assert.match(h.sent[0].html,/privacy-request\/confirm\?download=fixture-id/);assert.match(h.sent[0].html,/2026-11-19T10:00:00.000Z/);});
test('uncertain send beyond provider idempotency window never resends',async()=>{const {h,api,admin,op}=harness();op.handoff_at='2000-01-01T00:00:00Z';await assert.rejects(api.processExport(admin,op),e=>e.code==='delivery_reconciliation_required');assert.equal(h.sent.length,0);});
test('failed persistence after send is not claimed successful',async()=>{const {h,api,admin,op}=harness();h.record=false;await assert.rejects(api.processExport(admin,op),e=>e.code==='delivery_record_failed');});

test('fresh export emails real PDF and unchanged JSON; retries retain exact bytes and saved presentation',async()=>{
 const {h,api,admin,op}=harness();await api.processExport(admin,op);
 const first=h.sent[0];assert.equal(h.presentation.version,2);
 assert.deepEqual(Array.from(first.attachments,a=>a.filename),['dad-health-my-data.pdf','dad-health-data.json']);
 assert.equal(Buffer.from(first.attachments[0].content,'base64').subarray(0,5).toString(),'%PDF-');
 assert.deepEqual(JSON.parse(Buffer.from(first.attachments[1].content,'base64').toString()),h.payload);
 assert.match(first.html,/Open the PDF/);assert.equal(catalogue.exportAttachmentsFit(first.attachments),true);
 op.handoff_at=new Date().toISOString();await api.processExport(admin,op);
 assert.equal(JSON.stringify(h.sent[1]),JSON.stringify({...first,signal:h.sent[1].signal}));
 assert.equal(h.calls.filter(c=>c==='checkpoint').length,1);
});
test('legacy handed-off operation keeps its original JSON-only body and attachment',async()=>{
 const {h,api,admin,op}=harness();op.handoff_at=new Date().toISOString();await api.processExport(admin,op);
 assert.equal(h.sent[0].attachments.length,1);assert.equal(h.sent[0].attachments[0].filename,'dad-health-data.json');
 assert.equal(h.sent[0].html,'<p>Your Dad Health data is attached. This file contains personal information. Keep it somewhere safe.</p>');
 assert.equal(h.presentation,undefined);
});
test('combined MIME budget counts both base64 parts and envelope, not individual fit',()=>{
 const a={filename:'dad-health-my-data.pdf',content:'x'.repeat(2_500_000)};
 assert.equal(catalogue.exportAttachmentsFit([a]),true);assert.equal(catalogue.exportAttachmentsFit([a,a]),false);
});
test('oversized real PDF companion sends only the secure pair-download link',async()=>{
 const {h,api,admin,op}=harness();
 h.payload.sections.journal_entries[0].content=Array.from({length:20992},(_,i)=>String.fromCodePoint(0x4e00+i)).join('');
 await api.processExport(admin,op);
 assert.equal(h.sent[0].attachments,undefined);assert.equal(h.presentation.mode,'link');
 assert.match(h.sent[0].html,/Sign in to download your readable PDF and structured JSON copy/);assert.match(h.sent[0].html,/2026-11-19T10:00:00.000Z/);
});
test('persisted link presentation stays identical across origin changes and skips artifact materialization',async()=>{
 const {h,api,admin,op}=harness();h.payload.sections.large='x'.repeat(5_000_000);
 await api.processExport(admin,op);const html=h.sent[0].html;
 op.handoff_at=new Date().toISOString();await api.processExport(admin,op);
 assert.equal(h.sent[1].html,html);assert.equal(h.sent[1].attachments,undefined);assert.equal(h.presentation.mode,'link');
});
test('changed PDF presentation fails closed before retry authorization',async()=>{
 const {h,api,admin,op}=harness();await api.processExport(admin,op);op.handoff_at=new Date().toISOString();
 op.checkpoint.exportPresentation.hashes[0]='changed';h.calls=[];
 await assert.rejects(api.processExport(admin,op),e=>e.code==='presentation_changed');
 assert.ok(!h.calls.includes('authorize_account_export_send'));assert.equal(h.sent.length,1);
});

test('real PDF preserves multilingual values, nested data, nulls and long journals across pages',async()=>{
 const value=payload();value.sections.journal_entries[0]={content:'Café déjà vu — Ελληνικά 中文 日本語 😀\n'+
  Array.from({length:140},(_,i)=>`Journal line ${i}: a full saved reflection with no clipping.`).join('\n')+'\nFINAL JOURNAL LINE',
  prompt:'What mattered today?',nullable:null,empty:'',zero:0,details:{saved:[true,false,'nested value']}};
 value.sections.photoManifest=[{path:'owner/photo.jpg',created_at:null}];
 value.sections.unknown_section=[{custom_field:'All sections retained'}];
 const source=JSON.stringify(value);
 const generated=await pdf.renderExportPdf((async function*(){for(let i=0;i<source.length;i+=127)yield source.slice(i,i+127);})(),value.generatedAt);
 try {
  assert.ok(generated.pages>=3);assert.ok(generated.bytes>1000);
  const parsed=await getDocument({data:new Uint8Array(await readFile(generated.path)),useSystemFonts:false}).promise;
  const extracted={pages:parsed.numPages,text:'',bounds:true};
  try { for(let i=1;i<=parsed.numPages;i++) {
   const page=await parsed.getPage(i),view=page.getViewport({scale:1}),content=await page.getTextContent();
   for(const item of content.items)if('str' in item) {
    extracted.text+=item.str+'\n';
    extracted.bounds&&=item.transform[4]>=0&&item.transform[5]>=0&&item.transform[4]+item.width<=view.width+1&&item.transform[5]<=view.height+1;
   }
  }} finally {await parsed.destroy();}
  for(const expected of ['Your Dad Health data','Café','Ελληνικά','中文','日本語','😀','FINAL JOURNAL LINE','What mattered today?',
   'No saved value (null)','(Empty text)','nested value','owner/photo.jpg','All sections retained','2026-11-18T10:00:00Z'])assert.ok(extracted.text.includes(expected),expected);
  assert.ok(extracted.text.includes('(continued)'));
  assert.equal(extracted.bounds,true);assert.equal(extracted.pages,generated.pages);
  for(let i=1;i<=generated.pages;i++)assert.ok(extracted.text.includes(`Page ${i}`));
  if(process.env.PDF_VISUAL_OUTPUT) {
   await mkdir(process.env.PDF_VISUAL_OUTPUT,{recursive:true});await copyFile(generated.path,process.env.PDF_VISUAL_OUTPUT+'/fixture.pdf');
   execFileSync('python',['-c',`import pymupdf,sys\nd=pymupdf.open(sys.argv[1])\nfor i in sorted(set([0,1,len(d)-1])): d[i].get_pixmap(matrix=pymupdf.Matrix(1,1)).save(sys.argv[2]+'/page-'+str(i+1)+'.png')`,generated.path,process.env.PDF_VISUAL_OUTPUT],{env:{...process.env,PYTHONPATH:process.env.PDF_INSPECT_PYTHONPATH}});
  }
 } finally {await generated.dispose();}
});

function downloadHarness(){
 const value=payload(),source=JSON.stringify(value),owner='05000000-0000-4000-8000-000000000001',id='05000000-0000-4000-8000-000000000011';
 const h={allowed:true,authenticated:true,reads:0,maxLimit:0,metadataReads:0};
 const admin={rpc:async(name,args)=>{
  assert.equal(name,'read_account_export_chunk');assert.equal(args.p_user_id,owner);assert.equal(args.p_id,id);
  h.reads++;h.maxLimit=Math.max(h.maxLimit,args.p_limit);
  return {error:null,data:h.allowed?{text:Array.from(source).slice(args.p_offset,args.p_offset+args.p_limit).join(''),length:Array.from(source).length}:null};
 },from:table=>{assert.equal(table,'account_export_artifacts');h.metadataReads++;return {select:columns=>{assert.equal(columns,'payload->>generatedAt');return {eq:(column,value)=>{assert.equal(column,'operation_id');assert.equal(value,id);return {single:async()=>({data:{generatedAt:value===id?payload().generatedAt:null},error:null})};}};}};}};
 class HttpError extends Error{constructor(reason,status=503){super(reason);this.status=status;}}
 const route=load('src/app/api/account/exports/[id]/download/route.ts',{
  '@/lib/privacy/export-pdf':pdf,'node:fs':require('node:fs'),
  '@/lib/privacy/auth':{tracePrivacy:(_r,fn)=>fn(),privacyStage(){},privacyRpcFailure:()=>new HttpError('unavailable'),
   isId:v=>v===id,PrivacyError:HttpError,authenticatePrivacy:async()=>{if(!h.authenticated)throw new HttpError('unauthorized',401);return {admin,user:{id:owner}};},
   privacyFailure:e=>new Response(null,{status:e.status??503})},
 });
 return {h,route,id,get:(query='',signal)=>route.GET(new Request('https://fixture.invalid/download'+query,{signal}),{params:Promise.resolve({id})})};
}
test('PDF download uses the same owner-gated capture and private headers; JSON stays streaming',async()=>{
 const {h,get}=downloadHarness();const response=await get('?format=pdf');
 assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'application/pdf');
 assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
 const bytes=new Uint8Array(await response.arrayBuffer());const parsed=await getDocument({data:bytes}).promise;
 assert.ok(parsed.numPages>=1);await parsed.destroy();assert.ok(h.reads>=3);assert.equal(h.metadataReads,1);
 const json=await get('?format=json');assert.deepEqual(await json.json(),payload());assert.equal(h.metadataReads,1);
});
test('PDF and JSON reject anonymous, wrong-owner/expired/deleting artifacts and ambiguous formats',async()=>{
 for(const format of ['pdf','json']) {
  const {h,get}=downloadHarness();h.authenticated=false;assert.equal((await get('?format='+format)).status,401);assert.equal(h.reads,0);
  h.authenticated=true;h.allowed=false;
  // The existing RPC returns null for each of these database restrictions.
  for(const restriction of ['wrong-owner','expired','deleting'])assert.equal((await get('?format='+format)).status,404,restriction);
  assert.equal(h.metadataReads,0);
 }
 for(const query of ['?format=html','?format=PDF','?format=pdf&format=json','?format=']) {
  const {h,get}=downloadHarness();assert.equal((await get(query)).status,400);assert.equal(h.reads,0);
 }
});
test('PDF stream rechecks revocation before delivering bytes and cancels safely',async()=>{
 const {h,get}=downloadHarness();const response=await get('?format=pdf');h.allowed=false;
 await assert.rejects(response.arrayBuffer());
 const another=downloadHarness();const download=await another.get('?format=pdf');await download.body.cancel();
});
test('PDF generation propagates malformed capture and cancelled input rather than a partial success',async()=>{
 await assert.rejects(pdf.renderExportPdf((async function*(){yield '{"sections":';})(),payload().generatedAt));
 const abort=new AbortController();abort.abort();
 await assert.rejects(pdf.renderExportPdf((async function*(){yield JSON.stringify(payload());})(),payload().generatedAt,abort.signal));
});

test('large PDF consumes incremental capture under a bounded heap without collecting records',()=>{
 const script=`
 import {renderExportPdf} from './src/lib/privacy/export-pdf.ts';
 let bytes=0,peakHeap=0;
 async function* chunks(){
  yield '{"sections":{"journal_entries":[{"content":"';
  for(let i=0;i<600;i++) {
   const chunk=('saved reflection '+i+' ').repeat(600);
   bytes+=Buffer.byteLength(chunk);peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);yield chunk;
  }
  yield 'FINAL LARGE JOURNAL LINE"}]}}';
 }
 const result=await renderExportPdf(chunks(),'2026-11-18T10:00:00Z');
 try {console.log(JSON.stringify({inputBytes:bytes,peakHeap,pages:result.pages,outputBytes:result.bytes}));}
 finally{await result.dispose();}`;
 const result=JSON.parse(execFileSync(process.execPath,['--max-old-space-size=128','--input-type=module','-e',script],{encoding:'utf8',timeout:180000}));
 assert.ok(result.inputBytes>5_000_000);assert.ok(result.pages>100);assert.ok(result.outputBytes>1000);
 assert.ok(result.peakHeap<128*1024*1024);console.log('Bounded PDF fixture:',result);
});

// Opt-in: only the named disposable local database, never a connection URL.
if (process.env.ITEM05_LOCAL_DB === 'dadhealth-item05-acceptance') {
 test('independent connections serialize capture/edit and send/delete with actual lock waits',async()=>{
  const {spawn,execFileSync}=await import('node:child_process');
  const container=process.env.ITEM05_LOCAL_DB;
  const sql=q=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],{input:q,encoding:'utf8'}).trim();
  const owner='05000000-0000-4000-8000-000000000041',op='05000000-0000-4000-8000-000000000042',lease='05000000-0000-4000-8000-000000000043',del='05000000-0000-4000-8000-000000000044';
  const role="select set_config('request.jwt.claim.role','service_role',false);";
  function session(name,query){const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1']);let out='',err='';child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);
   const done=new Promise((resolve,reject)=>child.on('close',code=>code===0?resolve(out):reject(Error(err))));
   child.stdin.write(`set application_name='${name}';${role}${query}\n`);return {child,done,output:()=>out};}
  async function until(fn){for(let i=0;i<80;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}assert.fail('Expected database transition not observed');}
  const sessions=[];
  try{
   sql(`${role}insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values('${owner}','race@example.invalid',now(),'{}');
   insert into journal_entries(user_id,content,mood_value) values('${owner}','before concurrent edit',3);
   insert into account_privacy_operations(id,user_id,kind,recovery_hash,destination,state,lease_token,lease_until) values('${op}','${owner}','export',repeat('b',64),'race@example.invalid','processing','${lease}',now()+interval '5 minutes');`);
   const capture=session('item05_capture',`begin;select capture_account_export('${op}','${lease}');\n\\echo CAPTURED`);sessions.push(capture);
   await until(()=>capture.output().includes('CAPTURED'));
   const writer=session('item05_edit',`update journal_entries set content='after concurrent edit' where user_id='${owner}';`);sessions.push(writer);writer.child.stdin.end();
   await until(()=>sql("select count(*) from pg_stat_activity where application_name='item05_edit' and wait_event='advisory'")==='1');
   capture.child.stdin.end('commit;\n');await capture.done;await writer.done;
   assert.equal(sql(`select payload->'sections'->'journal_entries'->0->>'content' from account_export_artifacts where operation_id='${op}'`),'before concurrent edit');
   assert.equal(sql(`select content from journal_entries where user_id='${owner}'`),'after concurrent edit');
   assert.equal(sql(`${role}select capture_account_export('${op}','${lease}');`).split('\n').at(-1),'t');
   const sender=session('item05_send',`begin;select authorize_account_export_send('${op}','${lease}');\n\\echo AUTHORIZED`);sessions.push(sender);
   await until(()=>sender.output().includes('AUTHORIZED'));
   const deletion=session('item05_delete',`select confirm_account_privacy_operation('${owner}','${del}','delete',repeat('c',64),null,now()+interval '5 minutes');select request_account_privacy_operation('${owner}','${del}','delete',repeat('c',64),repeat('d',64));`);sessions.push(deletion);deletion.child.stdin.end();
   await until(()=>sql("select count(*) from pg_stat_activity where application_name='item05_delete' and wait_event='advisory'")==='1');
   sender.child.stdin.end('commit;\n');await sender.done;await deletion.done;
   assert.equal(sql(`select handoff_at is not null from account_privacy_operations where id='${op}'`),'t');
   assert.equal(sql(`${role}select authorize_account_export_send('${op}','${lease}') is null;`).split('\n').at(-1),'t');
   assert.equal(sql(`select count(*) from account_deletion_tombstones where user_id='${owner}'`),'1');
  }finally{
   for(const s of sessions){if(!s.child.stdin.destroyed)s.child.stdin.end('rollback;\n');await s.done.catch(()=>{});}
   sql(`delete from account_export_artifacts where user_id='${owner}';delete from account_privacy_confirmations where user_id='${owner}';delete from account_privacy_operations where user_id='${owner}';delete from account_deletion_tombstones where user_id='${owner}';delete from auth.users where id='${owner}';`);
  }
 });
}

test('large worker export never materializes artifact or base64 payload',async()=>{
 const {api,admin,op,h}=harness();h.payload.sections.large='x'.repeat(16000000);admin.from=()=>{throw Error('large payload must not be fetched');};
 await api.processExport(admin,op);assert.equal(h.sent.length,1);assert.equal(h.sent[0].attachments,undefined);
});

// Email assertions use the real presentation helper; transport remains isolated.
test('export emails use branded inline tables, escaped authenticated links and exact expiry',async()=>{
 const {api}=harness();
 const href='https://fixture.invalid/privacy-request/confirm?download=id&safe="quoted"';
 const html=api.exportEmailHtml(false,href,'2026-11-19T10:00:00Z','https://fixture.invalid');
 for(const expected of ['#0a0a0a','#111','#1f1f1f','#d9d9d9','#b8e64a','YOUR DATA IS READY','BUILT FOR DADS, BY DADS','alt="DH"','DOWNLOAD MY DATA','2026-11-19T10:00:00.000Z','role="presentation"','&amp;safe=&quot;quoted&quot;'])assert.ok(html.includes(expected),expected);
 assert.ok(!html.includes('{{'));assert.ok(!html.includes('Confirm your email'));
 const attached=api.exportEmailHtml(true,href,'2026-11-19T10:00:00Z','https://fixture.invalid');
 assert.match(attached,/Your Dad Health data is attached/);assert.match(attached,/Open the PDF/);
 assert.ok(!attached.includes('DOWNLOAD MY DATA'));assert.ok(Buffer.byteLength(html)<64000);
 if(process.env.PDF_VISUAL_OUTPUT) {
  await mkdir(process.env.PDF_VISUAL_OUTPUT,{recursive:true});
  await writeFile(process.env.PDF_VISUAL_OUTPUT+'/email-link.html',html);
  await writeFile(process.env.PDF_VISUAL_OUTPUT+'/email-attached.html',attached);
 }
});
