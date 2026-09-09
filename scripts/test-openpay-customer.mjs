import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('supabase/functions/_shared/openpay.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const cases = [
  { name: 'reuse', existing: 'saved', expected: 'saved', requests: 0 },
  { name: 'lookup failure', lookupError: {}, fails: true, requests: 0 },
  { name: 'missing user', missing: true, fails: true, requests: 0 },
  { name: 'new customer', saved: 'created', expected: 'created' },
  { name: 'concurrent winner, zero updated rows', saved: 'winner', expected: 'winner' },
  { name: 'update error with persisted winner', updateError: {}, saved: 'winner', expected: 'winner' },
  { name: 'update error without persisted ID', updateError: {}, fails: true },
  { name: 'zero rows without persisted ID', fails: true },
  { name: 'read failure with data', saved: 'created', readError: {}, fails: true },
  ...[null, {}, { id: '' }, { id: 123 }, { id: ' ' }].map(customer => ({ name: 'invalid provider ID', customer, fails: true })),
  { name: 'provider error', status: 400, fails: true },
];
for (const test of cases) {
  let requests = 0, reads = 0, updates = 0;
  const context = vm.createContext({ exports: {}, Response, btoa,
    console: { error() {} }, Deno: { env: { get: key => ({ OPENPAY_MERCHANT_ID: 'merchant', OPENPAY_PRIVATE_KEY: 'secret' })[key] } },
    async fetch(url, options) {
      requests++;
      assert.equal(url, 'https://sandbox-api.openpay.mx/v1/merchant/customers');
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body).email, 'test@example.com');
      assert.equal('id' in JSON.parse(options.body), false);
      return new Response(JSON.stringify('customer' in test ? test.customer : { id: 'created' }), { status: test.status || 200 });
    },
  });
  vm.runInContext(compiled, context);
  const client = { from(table) {
    assert.equal(table, 'users');
    const q = {
      select(column) { assert.equal(column, 'openpay_customer_id'); return q; },
      eq(column, id) { assert.equal(column, 'id'); assert.equal(id, 'user'); return q; },
      update(value) { updates++; assert.equal(value.openpay_customer_id, 'created'); return q; },
      is(column, value) { assert.equal(column, 'openpay_customer_id'); assert.equal(value, null); return Promise.resolve({ error: test.updateError }); },
      async maybeSingle() {
        reads++;
        return reads === 1
          ? { data: test.missing ? null : { openpay_customer_id: test.existing || null }, error: test.lookupError }
          : { data: { openpay_customer_id: test.saved || null }, error: test.readError };
      },
    };
    return q;
  } };
  const run = () => context.exports.createOrReuseCustomer(client, 'user', { email: 'test@example.com' });
  if (test.fails) await assert.rejects(run, undefined, test.name);
  else assert.equal(await run(), test.expected, test.name);
  assert.equal(requests, test.requests ?? 1, test.name);
  if ('customer' in test || test.status || test.requests === 0) assert.equal(updates, 0, test.name);
}
console.log(`OpenPay customer: ${cases.length} scenarios passed without network or payments.`);

// Execute the actual checkout customer-resolution block. A 502 must return
// before the charge branch; gift cards retain the inline-customer path.
const checkout = readFileSync('supabase/functions/create-openpay-checkout/index.ts', 'utf8');
const start = checkout.indexOf('    // Resolve or create an OpenPay customer');
const end = checkout.indexOf('    const orderId =', start);
assert.ok(start > 0 && end > start);
let checkoutCases = 0;
for (const kind of ['booking', 'supplement', 'gift_card']) {
  for (const failure of ['none', 'query', 'missing', 'helper']) {
    let calls = 0;
    const q = { select() { return q; }, eq() { return q; }, async maybeSingle() {
      return { data: failure === 'missing' ? null : { id: 'user', email: 'test@example.com' }, error: failure === 'query' ? {} : null };
    } };
    const ctx = vm.createContext({ Response, context: kind, supabase: { from: () => q }, user: { id: 'user' }, corsHeaders: {},
      console: { error() {} }, async createOrReuseCustomer() { calls++; if (failure === 'helper') throw Error('failure'); return 'saved'; },
    });
    const js = ts.transpileModule(`(async () => {${checkout.slice(start, end)} return { customerId }; })()`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const result = await vm.runInContext(js, ctx);
    if (kind !== 'gift_card' && failure !== 'none') assert.equal(result.status, 502);
    else assert.equal(result.customerId, kind === 'gift_card' ? null : 'saved');
    if (kind === 'gift_card' || failure === 'query' || failure === 'missing') assert.equal(calls, 0);
    checkoutCases++;
  }
}
console.log(`OpenPay checkout: ${checkoutCases} customer-resolution scenarios passed.`);
