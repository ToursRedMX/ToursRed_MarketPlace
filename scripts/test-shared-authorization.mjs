import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(name, globals = {}) {
  const source = readFileSync(new URL(`../supabase/functions/_shared/${name}.ts`, import.meta.url), 'utf8');
  const context = { exports: {}, Response, console: { warn() {} }, ...globals };
  vm.runInNewContext(ts.transpileModule(source.replace(/^import[^\n]*\n/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context.exports;
}
const cfdi = load('cfdiAuth', { Deno: { env: { get: () => 'service-key' } } });
const cfdiCases = [
  { token: '', status: 401, calls: 0 },
  { token: 'service-key', status: 200, calls: 0 },
  { role: 'admin', status: 200 }, { role: 'super_admin', status: 200 },
  { role: 'traveler', owner: 'caller', status: 200 },
  { role: 'agency', owner: 'caller', status: 200 },
  { role: 'traveler', owner: 'someone-else', status: 403 },
  { role: 'traveler', status: 403 }, { status: 403 },
  { noUser: true, owner: 'caller', status: 401 },
  { authError: true, role: 'admin', status: 401 },
  { profileError: true, role: 'admin', status: 503 },
  { profileError: true, owner: 'caller', status: 503 },
  { authThrows: true, status: 503 }, { profileThrows: true, status: 503 },
];
for (const test of cfdiCases) {
  let authCalls = 0;
  const client = {
    auth: { async getUser(token) {
      authCalls++;
      assert.equal(token, 'user-token');
      if (test.authThrows) throw new Error('private auth error');
      return { data: { user: test.noUser ? null : { id: 'caller' } }, error: test.authError ? {} : null };
    } },
    from(table) {
      assert.equal(table, 'users');
      const q = { select(column) { assert.equal(column, 'role'); return q; },
        eq(column, id) { assert.equal(column, 'id'); assert.equal(id, 'caller'); return q; },
        async maybeSingle() {
          if (test.profileThrows) throw new Error('private profile error');
          return { data: test.role ? { role: test.role } : null, error: test.profileError ? {} : null };
        } };
      return q;
    },
  };
  const req = new Request('https://example.test', { headers: { Authorization: `Bearer ${test.token ?? 'user-token'}` } });
  const result = await cfdi.authorizeCfdiRequest(client, req, { ownerUserId: test.owner, resource: 'test' });
  assert.equal(result.allowed ? 200 : result.response.status, test.status);
  assert.equal(authCalls, test.calls ?? 1);
  if (test.status === 503) assert.equal((await result.response.json()).code, 'CFDI_AUTH_UNAVAILABLE');
}

const verified = { totp: [{ id: 'factor', status: 'verified' }] };
const stepCases = [
  { factors: verified, rows: [{ id: 'verification' }], allowed: true },
  { factors: verified, rows: [], code: 'STEP_UP_REQUIRED' },
  { factors: verified, rows: null, code: 'STEP_UP_REQUIRED' },
  { factors: verified, rows: 'invalid', code: 'STEP_UP_REQUIRED' },
  { factors: verified, rows: [{}], code: 'STEP_UP_REQUIRED' },
  { factors: verified, rows: [{ id: 'verification' }], queryError: true, code: 'STEP_UP_REQUIRED' },
  { factors: verified, queryThrows: true, code: 'STEP_UP_REQUIRED' },
  { factors: verified, factorsError: true, code: 'MFA_NOT_CONFIGURED', noQuery: true },
  { factorsThrows: true, code: 'MFA_NOT_CONFIGURED', noQuery: true },
  { factors: null, code: 'MFA_NOT_CONFIGURED', noQuery: true },
  { factors: { totp: {} }, code: 'MFA_NOT_CONFIGURED', noQuery: true },
  { factors: { totp: [{ status: 'unverified' }] }, code: 'MFA_NOT_CONFIGURED', noQuery: true },
  { factors: { phone: [{ status: 'verified' }] }, code: 'MFA_NOT_CONFIGURED', noQuery: true },
  { factors: verified, userId: '', code: 'MFA_NOT_CONFIGURED', noQuery: true },
];
for (const test of stepCases) {
  let queries = 0;
  const step = load('stepUpCheck', { createClient(url, key) {
    queries++;
    assert.equal(url, 'https://db.test'); assert.equal(key, 'service-key');
    return { from(table) {
      assert.equal(table, 'sensitive_verifications');
      const q = { select() { return q; },
        eq(column, id) { assert.equal(column, 'user_id'); assert.equal(id, 'caller'); return q; },
        gt(column, date) { assert.equal(column, 'expires_at'); assert.ok(Math.abs(Date.now() - Date.parse(date)) < 1000); return q; },
        order() { return q; }, async limit(count) {
          assert.equal(count, 1);
          if (test.queryThrows) throw new Error('query failed');
          return { data: test.rows, error: test.queryError ? {} : null };
        } };
      return q;
    } };
  } });
  const client = { auth: { mfa: { async listFactors() {
    if (test.factorsThrows) throw new Error('MFA unavailable');
    return { data: test.factors, error: test.factorsError ? {} : null };
  } } } };
  const response = await step.enforceStepUp(client, 'service-key', 'https://db.test', test.userId ?? 'caller');
  if (test.allowed) assert.equal(response, null);
  else { assert.equal(response.status, 403); assert.equal((await response.json()).code, test.code); }
  assert.equal(queries, test.noQuery ? 0 : 1);
}
console.log(`Shared authorization: ${cfdiCases.length + stepCases.length} scenarios passed without network or business mutations.`);
