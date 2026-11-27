import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const exports = {};

vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL('../src/lib/stripe/verified-fields.ts', import.meta.url),
      'utf8'
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }
  ).outputText,
  { exports }
);

const { subscriptionPeriodEnd, invoiceSubscriptionId } = exports;
const end = 1800000000;
const expected = new Date(end * 1000).toISOString();

test('legacy subscription expiry is supported', () => {
  assert.equal(
    subscriptionPeriodEnd({ current_period_end: end }),
    expected
  );
});

test('modern subscription item expiry is supported', () => {
  assert.equal(subscriptionPeriodEnd({
    items: { data: [{ current_period_end: end }] }
  }), expected);
});

test('multiple items use the earliest expiry', () => {
  assert.equal(subscriptionPeriodEnd({
    items: {
      data: [
        { current_period_end: end + 3600 },
        { current_period_end: end }
      ]
    }
  }), expected);
});

test('missing or invalid expiry is rejected', () => {
  for (const value of [undefined, null, 0, -1, NaN, Infinity]) {
    assert.throws(() =>
      subscriptionPeriodEnd({ current_period_end: value })
    );
  }
});

test('incomplete subscription item list is rejected', () => {
  assert.throws(() => subscriptionPeriodEnd({
    items: {
      has_more: true,
      data: [{ current_period_end: end }]
    }
  }));
});

test('legacy invoice subscription references are supported', () => {
  assert.equal(invoiceSubscriptionId({
    subscription: 'sub_123'
  }), 'sub_123');

  assert.equal(invoiceSubscriptionId({
    subscription: { id: 'sub_123' }
  }), 'sub_123');
});

test('modern invoice subscription references are supported', () => {
  for (const subscription of ['sub_123', { id: 'sub_123' }]) {
    assert.equal(invoiceSubscriptionId({
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription }
      }
    }), 'sub_123');
  }
});

test('missing or invalid invoice references are ignored', () => {
  assert.equal(invoiceSubscriptionId({}), undefined);
  assert.equal(invoiceSubscriptionId({
    subscription: 'cus_123'
  }), undefined);
});
