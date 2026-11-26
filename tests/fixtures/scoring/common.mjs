import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
export const MIG = new URL('../../../supabase/migrations/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
export const read = (f) => readFileSync(MIG + f, 'utf8');
export const A = '00000000-0000-4000-8000-00000000000a';
export const B = '00000000-0000-4000-8000-00000000000b';

/** Minimal Supabase stand-ins: roles, auth.uid()/auth.role() from settings, auth.users. Synthetic ids only. */
export async function fresh() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users(id uuid primary key, email_confirmed_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    insert into auth.users(id) values ('${A}'), ('${B}');`);
  return db;
}

export async function as(db, role, sub = '') {
  await db.exec(`reset role; select set_config('request.jwt.claim.role','${role}',false), set_config('request.jwt.claim.sub','${sub}',false);`);
  if (role !== 'postgres') await db.exec(`set role ${role};`);
}

let failed = 0;
export function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' :: ' + detail}`);
  if (!ok) failed++;
}
export function done() {
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exitCode = failed ? 1 : 0;
}
export async function attempt(db, sql) {
  try { await db.exec(sql); return null; } catch (e) { return e.message; }
}
