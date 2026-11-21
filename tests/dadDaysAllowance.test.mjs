import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
const ageExports = {};
vm.runInNewContext(ts.transpileModule(await readFile(new URL('../src/lib/familyAges.ts', import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, {exports:ageExports});

const source = await readFile(new URL('../src/app/api/dad_days_searches/route.ts', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('export async function GET'), source.indexOf('function coerceNumber')).replace('export ', '');
const js = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function setup({ pro = false, countError = false, profile = null, profileError = false, signedIn = true } = {}) {
  const admin = { from(table) {
    return {
      select(columns) {
        if (table === 'user_profile') assert.equal(columns, 'kids_ages,custody_pattern');
        return this;
      },
      eq(key, owner) { assert.equal(key, 'user_id'); assert.equal(owner, 'test-user'); return this; },
      async maybeSingle() { return { data: profile, error: profileError ? {code:'57014'} : null }; },
      async gte() { return { count: 2, error: countError ? { code: '57014' } : null }; },
    };
  } };
  return new Function('NextResponse', 'getRequestUser', 'supabaseAdmin', 'startOfMonth', 'getSubscriptionSummary', 'FREE_SEARCH_LIMIT', 'console', 'youngestChildBand', 'diagnostics', `${js}; return GET;`)(
    { json: (body, options) => ({ body, status: options?.status ?? 200 }) },
    async () => signedIn ? ({ id: 'test-user' }) : null, admin, () => '2026-09-01', async () => ({isPro:pro}), 3, { error() {} }, ageExports.youngestChildBand, () => ({stage(){}, reply:body=>({body,status:200}),fail:(error,status)=>({body:{error},status})}),
  );
}

test('allowance works without a profile child-age column for Free and Pro', async () => {
  assert.deepEqual((await setup()({})).body, { isPro: false, searchesUsed: 2, limit: 3, childAge: null });
  assert.deepEqual((await setup({ pro: true })({})).body, { isPro: true, searchesUsed: null, limit: null, childAge: null });
});

test('an unavailable count fails closed instead of granting extra Free searches', async () => {
  assert.equal((await setup({ countError: true })({})).status, 503);
});

test('youngest saved age is owner-filtered; no children and failed profile reads require explicit selection', async () => {
  const profile={custody_pattern:'split',kids_ages:['teen_12_plus','primary_5_11','toddler_0_4']};
  assert.equal((await setup({profile})({})).body.childAge,'toddler');
  assert.equal((await setup({profile:{...profile,custody_pattern:'no_children'}})({})).body.childAge,null);
  assert.equal((await setup({profile,profileError:true})({})).body.childAge,null);
  assert.equal((await setup({signedIn:false})({})).status,401);
});
