import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const compile = source => ts.transpileModule(source.replace(/^import[^\n]*\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const quiet = { error() {} };
const helperContext = { exports: {}, Response, console: quiet };
vm.runInNewContext(compile(readFileSync('supabase/functions/_shared/aal2Check.ts', 'utf8')), helperContext);
const handlerCode = compile(readFileSync('supabase/functions/process-payment-refund/index.ts', 'utf8'));
const cases = [
  { token: '', status: 401 }, { token: 'Bearer', status: 401 },
  { noUser: true, status: 401 }, { authError: true, status: 401 },
  { role: 'traveler', status: 403 }, { role: 'agency', status: 403 },
  { role: 'account_executive', status: 403 }, { role: 'super_admin', status: 403 },
  { role: 'traveler', superAdmin: true, status: 403 },
  { role: 'admin', status: 403 },
  { role: 'admin', permission: true, profileError: true, status: 503 },
  { role: 'admin', permission: true, permissionError: true, status: 503 },
  { role: 'admin', permission: true, aal2: false, status: 403 },
  { role: 'admin', permission: true, rpcError: true, status: 503 },
  { role: 'admin', superAdmin: true, aal2: false, status: 403 },
  { role: 'admin', permission: true, aal2: true, status: 400 },
  { role: 'admin', superAdmin: true, aal2: true, status: 400 },
  { role: 'admin', permission: true, required: false, status: 400 },
  { token: 'Bearer service', status: 400 },
  { token: 'Bearer service', missingKey: true, status: 401 },
  { role: 'admin', permission: true, aal2: true, actor: true, status: 500 },
  { token: 'Bearer service', actor: true, status: 500 },
];
for (const test of cases) {
  let handler, authCalls = 0, rpcCalls = 0;
  const reads = [], writes = [];
  const token = test.token ?? 'Bearer user-token';
  const serviceClient = {
    auth: { async getUser(value) {
      authCalls++;
      assert.equal(value, 'user-token');
      return { data: { user: test.noUser ? null : { id: 'verified-admin' } }, error: test.authError ? {} : null };
    } },
    from(table) {
      reads.push(table);
      let inserted = false;
      const data = table === 'users' ? { role: test.role, is_super_admin: test.superAdmin }
        : table === 'admin_permissions' ? { can_cancel_bookings: test.permission }
        : table === 'payment_transactions' ? { id: 'tx', booking_id: 'booking', payment_processor: 'paypal', paypal_capture_id: 'capture', amount: '100', payment_method_type: 'card' } : null;
      const q = { select() { return q; }, in() { return q; },
        eq(column, value) { if (table === 'users' || table === 'admin_permissions') assert.equal(value, 'verified-admin'); return q; },
        insert(value) { inserted = true; writes.push(value); return q; }, update(value) { writes.push(value); return q; },
        async maybeSingle() { return { data, error: (table === 'users' && test.profileError) || (table === 'admin_permissions' && test.permissionError) ? {} : null }; },
        async single() { return { data: inserted ? { id: 'refund' } : data, error: null }; },
        then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
      }; return q;
    },
  };
  vm.runInNewContext(handlerCode, { exports: {}, Response, console: quiet, ...helperContext.exports,
    Deno: { serve(fn) { handler = fn; }, env: { get: key => ({ SUPABASE_SERVICE_ROLE_KEY: test.missingKey ? undefined : 'service', SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon' })[key] } },
    createClient(url, key, options) {
      if (key === 'service') return serviceClient;
      assert.equal(key, 'anon');
      assert.equal(options.global.headers.Authorization, token);
      return { async rpc(name) {
        rpcCalls++;
        return { data: name === 'requires_aal2_check' ? test.required ?? true : test.aal2, error: test.rpcError ? {} : null };
      } };
    },
    EdgeRuntime: { waitUntil() {} },
    async fetch(url) { assert.ok(url.startsWith('https://db.test/functions/v1/notify-ops-refund-failed')); return new Response('{}'); },
  });
  const response = await handler(new Request('https://handler.test', { method: 'POST', headers: token ? { Authorization: token } : {}, body: JSON.stringify(test.actor ? { booking_id: 'booking', payment_transaction_id: 'tx', amount: 25, created_by_user_id: 'spoofed' } : {}) }));
  assert.equal(response.status, test.status, JSON.stringify(test));
  if (!test.actor) assert.equal(writes.length, 0);
  else assert.equal(writes[0].created_by_user_id, token === 'Bearer service' ? 'spoofed' : 'verified-admin');
  if (test.status === 401) assert.equal(reads.length, 0);
  if (test.status === 403 || test.status === 503) assert.ok(!reads.includes('payment_transactions'));
  if (token === 'Bearer service') { assert.equal(authCalls, 0); assert.equal(rpcCalls, 0); }
}
console.log(`Refund authorization: ${cases.length} scenarios passed with the real MFA helper and no real refunds.`);
