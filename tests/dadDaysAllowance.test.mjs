import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/app/api/dad_days_searches/route.ts', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('export async function GET'), source.indexOf('function coerceNumber')).replace('export ', '');
const js = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function setup({ pro = false, countError = false } = {}) {
  const admin = { from(table) {
    return {
      select(columns) {
        assert.ok(!columns.includes('child_age'), 'Allowance must not query child age on the profile');
        return this;
      },
      eq() { return this; },
      async maybeSingle() { return { data: { is_pro: pro }, error: null }; },
      async gte() { return { count: 2, error: countError ? { code: '57014' } : null }; },
    };
  } };
  return new Function('NextResponse', 'getRequestUser', 'supabaseAdmin', 'startOfMonth', 'profileHasProAccess', 'FREE_SEARCH_LIMIT', 'console', `${js}; return GET;`)(
    { json: (body, options) => ({ body, status: options?.status ?? 200 }) },
    async () => ({ id: 'test-user' }), admin, () => '2026-09-01', p => p.is_pro, 3, { error() {} },
  );
}

test('allowance works without a profile child-age column for Free and Pro', async () => {
  assert.deepEqual((await setup()({})).body, { isPro: false, searchesUsed: 2, limit: 3, childAge: null });
  assert.deepEqual((await setup({ pro: true })({})).body, { isPro: true, searchesUsed: null, limit: null, childAge: null });
});

test('an unavailable count fails closed instead of granting extra Free searches', async () => {
  assert.equal((await setup({ countError: true })({})).status, 503);
});
