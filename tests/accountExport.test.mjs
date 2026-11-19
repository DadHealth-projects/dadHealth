import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import ts from 'typescript';import {readFileSync} from 'node:fs';
function load(path,deps={},extras={}){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Buffer,Date,URL,AbortSignal,process:{env:{PRIVACY_PUBLIC_ORIGIN:'https://fixture.invalid'}},require:id=>{assert.ok(id in deps,id);return deps[id];},...extras});return exports;}
const catalogue=load('src/lib/privacy/export-catalogue.ts');
class PrivacyError extends Error{constructor(code){super(code);this.code=code;}}
const payload=()=>({formatVersion:1,generatedAt:'2026-11-18T10:00:00Z',fieldExplanations:{null:'No value'},sections:{journal_entries:[{id:'one',content:'fixture',prompt:null}]}});
function harness(){const h={sent:[],calls:[],capture:true,authorize:{destination:'verified@example.invalid'},record:true,payload:payload()};const admin={rpc:async(name,args)=>{h.calls.push(name);return {data:name==='read_account_export_chunk'?{bytes:Buffer.byteLength(JSON.stringify(h.payload)),expiresAt:'2026-11-19T10:00:00Z'}:name==='capture_account_export'?h.capture:name==='authorize_account_export_send'?h.authorize:h.record,error:null};},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{payload:h.payload,expires_at:'2026-11-19T10:00:00Z'},error:null})})})})};const api=load('src/lib/privacy/export.ts',{'@/lib/email/resend':{sendEmail:async input=>{h.sent.push(input);return {id:'message-1'};}},'./auth':{PrivacyError},'./export-catalogue':catalogue});return {h,admin,api,op:{id:'fixture-id',lease_token:'lease',handoff_at:null}};}
test('JSON attachment preserves saved values and nulls',()=>{const a=catalogue.exportAttachment(payload());assert.deepEqual(JSON.parse(Buffer.from(a.content,'base64').toString()),payload());});
test('encoded message budget switches large data to private link',()=>{assert.equal(catalogue.exportAttachment({text:'x'.repeat(5_000_000)}),null);assert.ok(catalogue.exportAttachment({text:'small'}));});
test('failed or missing captured section container is never sent as empty export',async()=>{const {h,api,admin,op}=harness();h.payload={formatVersion:1,generatedAt:'2026-11-18T10:00:00Z'};await assert.rejects(api.processExport(admin,op));assert.equal(h.sent.length,0);});
test('email authorization denial sends nothing',async()=>{const {h,api,admin,op}=harness();h.authorize=null;await api.processExport(admin,op);assert.equal(h.sent.length,0);});
test('export uses rechecked address and stable provider idempotency key',async()=>{const {h,api,admin,op}=harness();await api.processExport(admin,op);assert.equal(h.sent[0].to,'verified@example.invalid');assert.equal(h.sent[0].idempotencyKey,'privacy-export/fixture-id');assert.deepEqual(h.calls,['capture_account_export','read_account_export_chunk','authorize_account_export_send','record_privacy_email_result']);});
test('large email contains authenticated URL and exact expiry',async()=>{const {h,api,admin,op}=harness();h.payload.sections.large='x'.repeat(5_000_000);await api.processExport(admin,op);assert.equal(h.sent[0].attachments,undefined);assert.match(h.sent[0].html,/privacy-request\/confirm\?download=fixture-id/);assert.match(h.sent[0].html,/2026-11-19T10:00:00.000Z/);});
test('uncertain send beyond provider idempotency window never resends',async()=>{const {h,api,admin,op}=harness();op.handoff_at='2000-01-01T00:00:00Z';await assert.rejects(api.processExport(admin,op),e=>e.code==='delivery_reconciliation_required');assert.equal(h.sent.length,0);});
test('failed persistence after send is not claimed successful',async()=>{const {h,api,admin,op}=harness();h.record=false;await assert.rejects(api.processExport(admin,op),e=>e.code==='delivery_record_failed');});

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
