import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('supabase/functions/process-payment-refund/index.ts', 'utf8');
const compiled = ts.transpileModule(source.replace(/^import[^\n]*\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const scenarios = [
  { name: 'database credentials', settings: { paypal_client_id: 'db-id', paypal_sandbox: true }, secret: 'db-secret', id: 'db-id', key: 'db-secret', sandbox: true },
  { name: 'environment credentials', envId: 'env-id', envSecret: 'env-secret', id: 'env-id', key: 'env-secret' },
  { name: 'environment priority and database mode', envId: 'env-id', envSecret: 'env-secret', settings: { paypal_client_id: 'db-id', paypal_sandbox: true }, id: 'env-id', key: 'env-secret', sandbox: true },
  { name: 'mixed credentials', envId: 'env-id', secret: 'db-secret', id: 'env-id', key: 'db-secret' },
  { name: 'missing credentials', fails: true },
  { name: 'settings failure', envId: 'env-id', envSecret: 'env-secret', settingsError: true, fails: true },
  { name: 'secret failure despite data', settings: { paypal_client_id: 'db-id' }, secret: 'db-secret', secretsError: true, fails: true },
  { name: 'token rejection', envId: 'env-id', envSecret: 'env-secret', id: 'env-id', key: 'env-secret', tokenFailure: true, fails: true },
  { name: 'unauthorized caller', denied: true },
];
for (const test of scenarios) {
  let handler;
  const requests = [], writes = [], reads = [];
  const client = { auth: { async getUser() { return { data: { user: null }, error: null }; } }, from(table) {
    reads.push(table);
    let mode = 'read';
    const result = () => ({
      data: table === 'payment_transactions' ? { id: 'tx', booking_id: 'booking', payment_processor: 'paypal', paypal_capture_id: 'capture', amount: '100', processor_fee: '5', payment_method_type: 'card' }
        : table === 'platform_settings' ? test.settings || null
        : table === 'platform_secrets' ? { paypal_client_secret: test.secret }
        : mode === 'insert' ? { id: 'refund' } : [],
      error: (table === 'platform_settings' && test.settingsError) || (table === 'platform_secrets' && test.secretsError) ? { message: 'private database detail' } : null,
    });
    const q = { select() { return q; }, eq() { return q; }, in() { return q; },
      insert(value) { mode = 'insert'; writes.push(value); return q; },
      update(value) { mode = 'update'; writes.push(value); return q; },
      async single() { return result(); },
      async maybeSingle() { return table === 'payment_refunds' ? { data: null, error: null } : result(); },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    }; return q;
  } };
  vm.runInNewContext(compiled, { exports: {}, Response, btoa, createClient: () => client,
    console: { error() {} }, EdgeRuntime: { waitUntil() {} },
    Deno: { serve(fn) { handler = fn; }, env: { get: key => ({ SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_URL: 'https://db.test', PAYPAL_CLIENT_ID: test.envId, PAYPAL_CLIENT_SECRET: test.envSecret })[key] } },
    async fetch(url, options) {
      if (url.startsWith('https://db.test/')) return new Response('{}');
      requests.push({ url, options });
      const base = test.sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
      if (url.endsWith('/token')) {
        assert.equal(url, base + '/v1/oauth2/token');
        assert.equal(options.headers.Authorization, 'Basic ' + btoa(`${test.id}:${test.key}`));
        return new Response(JSON.stringify({ access_token: 'token' }), { status: test.tokenFailure ? 401 : 200 });
      }
      assert.equal(url, base + '/v2/payments/captures/capture/refund');
      assert.equal(options.headers.Authorization, 'Bearer token');
      assert.equal(JSON.parse(options.body).amount.value, '25.00');
      assert.ok(options.headers['PayPal-Request-Id']);
      return new Response(JSON.stringify({ id: 'provider-refund' }));
    },
  });
  const response = await handler(new Request('https://function.test', { method: 'POST', headers: { Authorization: test.denied ? 'Bearer user' : 'Bearer service' }, body: JSON.stringify({ booking_id: 'booking', payment_transaction_id: 'tx', amount: 25 }) }));
  assert.equal(response.status, test.denied ? 401 : test.fails ? 500 : 200, test.name);
  const body = await response.text();
  assert.ok(!body.includes('private database detail'));
  assert.equal(requests.length, test.denied ? 0 : test.tokenFailure ? 1 : test.fails ? 0 : 2, test.name);
  if (test.denied) { assert.equal(writes.length, 0); assert.equal(reads.length, 0); }
  else assert.equal(writes.at(-1).status, test.fails ? 'failed' : 'processing', test.name);
  if (test.envSecret) assert.ok(!reads.includes('platform_secrets'));
}
console.log(`PayPal refund config: ${scenarios.length} full-handler scenarios passed without real refunds.`);
