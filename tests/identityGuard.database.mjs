// Opt-in PGlite proof: the reconciled identity guard (20261126165000, identical to production)
// fails closed where the committed 20261126132000 did not. Never connects to any server.
//   npm i --no-save @electric-sql/pglite@0.2 && node --test tests/identityGuard.database.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let PGlite = null;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { /* opt-in */ }
const skip = !PGlite && 'PGlite not installed (opt-in)';
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b';

async function guard(migration) {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
    create table public.account_deletion_tombstones(user_id uuid primary key);
    insert into auth.users values ('${A}'), ('${B}');
    ${read(migration)}`);
  const ask = async (aliases) => (await db.query('select public.analytics_identity_aliases_safe($1, $2) v', [A, aliases])).rows[0].v;
  return { db, ask };
}

test('identity guard: null aliases fail closed in the reconciled version; every other answer unchanged', { skip }, async () => {
  const old = await guard('20261126132000_analytics_identity_guard.sql');
  const fixed = await guard('20261126165000_m3_identity_guard_null_safe.sql');
  assert.equal(await old.ask(null), true, 'committed version: NULL input passes (the defect)');
  assert.equal(await fixed.ask(null), false, 'reconciled version: NULL input fails closed');
  for (const aliases of [JSON.stringify([A]), JSON.stringify([A, 'anon-device-1']), JSON.stringify([A, B]), JSON.stringify(['other']),
    JSON.stringify([A, 5]), JSON.stringify([A, '']), '{}', JSON.stringify([A.toUpperCase(), A])]) {
    assert.equal(await fixed.ask(aliases), await old.ask(aliases), aliases);
  }
  assert.equal(await fixed.ask(JSON.stringify([A, B])), false, 'another account is never an alias');
  assert.equal(await fixed.ask(JSON.stringify([A, 'anon-device-1'])), true);
  await old.db.close(); await fixed.db.close();
});
