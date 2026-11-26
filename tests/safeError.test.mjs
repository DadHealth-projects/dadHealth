import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/safeError.ts', import.meta.url), 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
const plain = value => JSON.parse(JSON.stringify(value));
test('safe errors retain only known database/network codes and valid HTTP status', () => {
  assert.deepEqual(plain(exports.safeError({ code: '42501', status: 403, message: 'private', body: 'private', headers: { authorization: 'private' } })), { code: '42501', status: 403 });
});
test('provider text, unknown codes, stack, null and invalid status never leak', () => {
  for (const input of [null, 'private', new Error('private'), { code: 'private', status: '500', stack: 'private' }]) {
    assert.deepEqual(plain(exports.safeError(input)), { code: 'operation_failed' });
  }
});
test('privileged admin module declares the enforced Next server-only boundary', () => {
  const admin = readFileSync(new URL('../src/utils/supabase/admin.ts', import.meta.url), 'utf8');
  assert.match(admin, /^import 'server-only';/);
});
