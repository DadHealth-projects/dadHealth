// Opt-in, disposable local Docker database only. No network Supabase credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const enabled=process.env.MIND_PLAN_LOCAL_DB==='dadhealth_item04_mind_plan';
const args=['exec','-i','dadhealth-weekly-full-schema','psql','-X','-qAt','-U','supabase_admin','-d','dadhealth_item04_mind_plan','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('docker',args,{input:q,encoding:'utf8'}).trim();
const role="set request.jwt.claim.role='service_role';";
function fixture(){const id=randomUUID();sql(`insert into auth.users(id,email) values('${id}','${id}@example.invalid');update public.user_profile set manual_pro_grant=true where user_id='${id}';`);return id;}
function run(query){
 const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code?reject(Error(err)):resolve(out.trim()));});
 child.stdin.end(query);return done;
}
async function contend(owner,operation){
 const holder=spawn('docker',args,{stdio:['pipe','pipe','pipe']});let output='';let released=false;
 const holderDone=new Promise(resolve=>holder.on('close',resolve));
 const ready=new Promise((resolve,reject)=>{
  holder.on('error',reject);holder.stderr.on('data',v=>reject(Error(String(v))));
  holder.stdout.on('data',v=>{output+=v;if(output.includes('LOCKED'))resolve();});
 });
 holder.stdin.write(`begin;select pg_advisory_xact_lock(hashtextextended('mind-plan:${owner}',0));select 'LOCKED';\n`);
 try{
  await ready;
  const names=[randomUUID(),randomUUID()];
  const attempts=names.map(name=>run(`set application_name='mind-plan-${name}';${role}${operation}`));
  let waiters=0;
  for(let i=0;i<50;i++){
   waiters=Number(sql(`select count(*) from pg_stat_activity where application_name in ('mind-plan-${names[0]}','mind-plan-${names[1]}') and wait_event='advisory';`));
   if(waiters===2)break;
   await new Promise(resolve=>setTimeout(resolve,40));
  }
  holder.stdin.end('commit;\n');released=true;
  const result=await Promise.all(attempts);
  assert.equal(waiters,2,'both independent sessions observed waiting on advisory lock');
  return result.map(JSON.parse);
 }finally{if(!released)holder.stdin.end('rollback;\n');await holderDone;}
}
test('real concurrent starts wait on owner lock and return one immutable plan',{skip:!enabled},async()=>{
 const owner=fixture();const results=await contend(owner,`select public.mind_plan_operation('${owner}','start');`);
 assert.equal(results[0].state,'available');assert.equal(results[0].plan.id,results[1].plan.id);
 assert.deepEqual(results[0].plan.actions,results[1].plan.actions);
 assert.equal(sql(`select count(*) from public.mind_plans where user_id='${owner}';`),'1');
});
test('real concurrent duplicate completions return identical receipt and one row',{skip:!enabled},async()=>{
 const owner=fixture();const plan=JSON.parse(sql(`${role}select public.mind_plan_operation('${owner}','start');`)).plan;
 const results=await contend(owner,`select public.mind_plan_operation('${owner}','complete','${plan.id}',1);`);
 assert.deepEqual(results[0].receipt,results[1].receipt);
 assert.equal(sql(`select count(*) from public.mind_plan_completions where user_id='${owner}';`),'1');
});
test('rollback removes partial start/completion and a retry succeeds',{skip:!enabled},()=>{
 const owner=fixture();
 sql(`begin;${role}select public.mind_plan_operation('${owner}','start');rollback;`);
 assert.equal(sql(`select count(*) from public.mind_plans where user_id='${owner}';`),'0');
 const plan=JSON.parse(sql(`${role}select public.mind_plan_operation('${owner}','start');`)).plan;
 sql(`begin;${role}select public.mind_plan_operation('${owner}','complete','${plan.id}',1);rollback;`);
 assert.equal(sql(`select count(*) from public.mind_plan_completions where user_id='${owner}';`),'0');
 const saved=JSON.parse(sql(`${role}select public.mind_plan_operation('${owner}','complete','${plan.id}',1);`));
 assert.equal(saved.plan.nextAction,2);
});
test('actual stored PostgreSQL JSON passes the backend allowlist projection',{skip:!enabled},async()=>{
 const owner=fixture();const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/mind/plan.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
 }).outputText,{exports,Date});
 const saved=JSON.parse(sql(`${role}select public.mind_plan_operation('${owner}','start');`));
 const result=await exports.operateMindPlan({rpc:async()=>({data:saved,error:null})},owner,'read');
 assert.equal(result.state,'available');assert.equal(result.plan.actions.length,7);assert.equal(result.plan.id,saved.plan.id);
});
