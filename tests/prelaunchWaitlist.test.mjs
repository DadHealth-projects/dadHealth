import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/app/api/waitlist/route.ts', import.meta.url), 'utf8');
function handler(sendEmail) {
  const exports = {};
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  new Function('exports', 'require', compiled)(exports, name => {
    if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (name === '@/lib/email/resend') return { sendEmail };
    throw new Error(`Unexpected dependency: ${name}`);
  });
  return body => exports.POST(new Request('http://localhost/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

test('honeypot returns quietly without sending email', async () => {
  const post = handler(() => assert.fail('Email must not send'));
  assert.equal((await post({ email: 'test@example.invalid', website: 'spam' })).status, 200);
});
test('invalid input is rejected before email', async () => {
  const post = handler(() => assert.fail('Email must not send'));
  for (const value of [null, [], { email: 'invalid' }, { email: 'a@example.invalid', firstName: 'x'.repeat(101) }]) {
    assert.equal((await post(value)).status, 400);
  }
});
test('signup notifies only the team, escapes content, and preserves repeat-submission behaviour', async () => {
  const emails = [];
  const post = handler(async args => emails.push(args));
  const input = { firstName: '<script>', email: ' TEST@example.invalid ', website: '' };
  assert.equal((await post(input)).status, 200);
  assert.equal((await post(input)).status, 200);
  assert.equal(emails.length, 2); // Existing route does not deduplicate; do not promise a once-only email.
  for (const email of emails) {
    assert.equal(email.to, 'hello@dadhealth.co.uk');
    assert.match(email.html, /&lt;script&gt;/);
    assert.match(email.html, /test@example\.invalid/);
    assert.doesNotMatch(email.html, /<script>/);
  }
});
test('email failure returns failure, not signup success', async () => {
  const post = handler(async () => { throw new Error('provider unavailable'); });
  assert.equal((await post({ email: 'test@example.invalid' })).status, 502);
});
