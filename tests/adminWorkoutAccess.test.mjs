import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const route = read('src/app/api/admin/[resource]/route.ts');
const post = route.slice(route.indexOf('export async function POST'));
const branch = post.slice(post.indexOf('case "workouts": {') + 'case "workouts": {'.length, post.indexOf('case "therapists": {')).replace(/}\s*$/, '');
async function create(body) {
  let inserted;
  const context = {
    body,
    NextResponse: { json: (data, options) => ({ data, status: options?.status ?? 200 }) },
    supabase: { from: () => ({ insert: (value) => {
      inserted = value;
      return { select: () => ({ single: async () => ({ data: value, error: null }) }) };
    } }) },
  };
  const response = await vm.runInNewContext(`(async () => {${branch}})()`, context);
  return { response, inserted };
}

test('Admin creation defaults to Pro and accepts explicit Free or Pro', async () => {
  for (const access of [undefined, 'free', 'pro']) {
    const result = await create({ title: 'Workout', access_level: access });
    assert.equal(result.response.status, 200);
    assert.equal(result.inserted.access_level, access ?? 'pro');
    assert.equal(result.inserted.source, 'admin');
    assert.equal(result.inserted.user_id, null);
  }
});

test('Admin rejects invalid access before saving', async () => {
  for (const access_level of [null, '', 'public', true]) {
    const result = await create({ access_level });
    assert.equal(result.response.status, 400);
    assert.equal(result.inserted, undefined);
  }
});

test('Admin editing validates provided access and leaves omitted access unchanged', () => {
  const start = route.indexOf('  const { id, ...updates } = body;');
  const code = route.slice(start, route.indexOf('  if (!id)', start));
  for (const access of [undefined, 'free', 'pro', 'invalid', null]) {
    const response = vm.runInNewContext(`(() => {${code}\nreturn updates;})()`, {
      body: access === undefined ? { id: 'one', title: 'Edited' } : { id: 'one', access_level: access },
      resource: 'workouts', NextResponse: { json: (_, options) => options },
    });
    if (access === 'invalid' || access === null) assert.equal(response.status, 400);
    else assert.equal(response.access_level, access);
  }
});

test('Edit form preserves access; legacy metadata defaults Pro', () => {
  const page = read('src/app/admin/page.tsx');
  const start = page.indexOf('function workoutToForm(');
  const code = page.slice(start, page.indexOf('function WorkoutsTab()', start));
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { workoutsToText: () => '' };
  vm.runInNewContext(compiled, context);
  for (const access of [undefined, 'free', 'pro']) {
    assert.equal(context.workoutToForm({ access_level: access }).access_level, access ?? 'pro');
  }
});
