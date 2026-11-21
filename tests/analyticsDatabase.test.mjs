import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
// Deliberately isolated dependency fixture, NOT a claim of full Supabase schema coverage.
const container=process.env.ANALYTICS_TEST_CONTAINER;
const db=`analytics_fixture_${Date.now()}`;
const args=['exec','-i',container??'', 'psql','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-At'];
const sql=s=>execFileSync('docker',args,{input:s,encoding:'utf8'}).trim();
const auth="select set_config('request.jwt.claim.role','service_role',false);";
function session(s){const p=spawn('docker',args);let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.stdin.end(s);return new Promise((resolve,reject)=>p.on('exit',code=>code?reject(Error(err)):resolve(out)));}
test('isolated migration, permissions, export, withdrawal, deletion and retention SQL',{skip:!container},async()=>{
 assert.match(container,/^dadhealth-analytics-local-/);
 execFileSync('docker',['exec',container,'createdb','-U','postgres',db]);
 sql(`create schema auth;
 do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
 end$$;
 create table auth.users(id uuid primary key);
 create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
 create table public.account_deletion_tombstones(user_id uuid primary key, operation_id uuid not null default gen_random_uuid(), accepted_at timestamptz not null default now());
 create function public.account_export_dataset(p_user_id uuid) returns jsonb language sql stable as $$select jsonb_build_object('sections',jsonb_build_object('fixture',jsonb_build_array(jsonb_build_object('nullable',null))))$$;
 revoke all on function public.account_export_dataset(uuid) from public;
 `);
 sql(readFileSync('supabase/migrations/20261120120000_optional_analytics_foundation.sql','utf8'));
 const result=sql(readFileSync('supabase/tests/analytics_foundation.sql','utf8'));
 const assertions=result.split('\n').filter(l=>l.startsWith('PASS:'));
 assert.equal(assertions.length,26);console.log(`SQL assertions: ${assertions.length}; disposable database: ${db}`);
});
test('independent sessions: duplicate ingestion, real owner-lock contention and rollback',{skip:!container},async()=>{
 const owner='66666666-6666-4666-8666-666666666666',consent='77777777-7777-4777-8777-777777777777',id='88888888-8888-4888-8888-888888888888';
 sql(`insert into auth.users values('${owner}');insert into analytics_consents(id,user_id,secret_hash,distinct_id) values('${consent}','${owner}',repeat('f',64),'${owner}')`);
 const event=JSON.stringify({version:1,id,event:'app_opened',timestamp:new Date().toISOString(),properties:{}});
 const ingest=`select public.ingest_optional_analytics('${owner}','${consent}',repeat('f',64),'${event}'::jsonb);`;
 await Promise.all([session(auth+ingest),session(auth+ingest)]);assert.equal(sql(`select count(*) from analytics_outbox where id='${id}'`),'1');
 let held='';const holder=spawn('docker',args);holder.stdout.on('data',b=>held+=b);
 const holding=new Promise((resolve,reject)=>{holder.on('error',reject);holder.on('close',code=>code?reject(Error('lock fixture failed')):resolve());});
 holder.stdin.write(`${auth}begin;set application_name='analytics-holder';select pg_advisory_xact_lock_shared(hashtextextended('account-privacy:${owner}',0));select 'HELD';\n`);
 for(let i=0;i<100&&!held.includes('HELD');i++)await new Promise(r=>setTimeout(r,50));
 assert.match(held,/HELD/);
 const deleting=session(`${auth}begin;set application_name='analytics-deleter';select pg_advisory_xact_lock(hashtextextended('account-privacy:${owner}',0));insert into account_deletion_tombstones(user_id) values('${owner}');commit;`);
 let waited=false;for(let i=0;i<30;i++){if(sql("select count(*) from pg_stat_activity where application_name='analytics-deleter' and wait_event='advisory'")==='1'){waited=true;break;}await new Promise(r=>setTimeout(r,50));}
 holder.stdin.end('commit;\n');await Promise.all([holding,deleting]);assert.equal(waited,true,'second connection actually waits for advisory lock');
 assert.equal(sql(`select count(*) from analytics_outbox where user_id='${owner}'`),'0');assert.match(sql(auth+ingest),/removed/);
 sql("insert into analytics_consents(id,secret_hash,distinct_id) values('99999999-9999-4999-8999-999999999999',repeat('a',64),'anonymous-fixture')");
 const anon=`select public.ingest_optional_analytics(null,'99999999-9999-4999-8999-999999999999',repeat('a',64),'${JSON.stringify({...JSON.parse(event),id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})}');`;
 sql(`${auth}begin;${anon}rollback;`);assert.equal(sql("select count(*) from analytics_outbox where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'"),'0');
 assert.match(sql(auth+anon),/accepted/);console.log('Observed wait_event=advisory; duplicate=one row; deletion barrier and rollback/retry passed.');
});
