import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../supabase/functions/', import.meta.url);
const quiet = { log() {}, warn() {}, error() {} };
function evaluate(source, globals = {}) {
  const context = { exports: {}, Response, Request, Headers, console: quiet, ...globals };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context.exports;
}
const helper = evaluate(readFileSync(new URL('_shared/aal2Check.ts', root), 'utf8'));
const ok = (data) => ({ data, error: null });
const cases = [];
for (const required of [false, 'false']) cases.push({ responses: [ok(required)], allowed: true });
for (const required of [true, 'true']) {
  for (const aal2 of [true, 'true', false, 'false']) {
    cases.push({ responses: [ok(required), ok(aal2)], allowed: aal2 === true || aal2 === 'true' });
  }
}
for (const value of [null, undefined, 0, 1, '', 'TRUE', 'False', {}, [], [true]]) {
  cases.push({ responses: [ok(value)], allowed: false, failed: true });
  cases.push({ responses: [ok(true), ok(value)], allowed: false, failed: true });
}
for (const bad of [null, undefined, { data: false, error: { message: 'unavailable' } }, new Error('RPC rejected')]) {
  cases.push({ responses: [bad], allowed: false, failed: true });
  cases.push({ responses: [ok(true), bad], allowed: false, failed: true });
}
function rpcFor(test, calls) {
  return (name) => {
    assert.equal(name, calls.length === 0 ? 'requires_aal2_check' : 'has_aal2');
    const response = test.responses[calls.length];
    calls.push(name);
    // Exercise a PostgREST-style thenable, without Promise.catch/finally.
    return { then(resolve, reject) {
      if (response instanceof Error) reject(response);
      else resolve(response);
    } };
  };
}
for (const test of cases) {
  const calls = [];
  const result = await helper.checkAal2Required({ rpc: rpcFor(test, calls) });
  assert.equal(result.allowed, test.allowed);
  assert.equal(calls.length, test.responses.length);
  if (!test.allowed) {
    const response = helper.aal2Response(result.reason, result.code);
    assert.equal(response.status, test.failed ? 503 : 403);
    assert.equal((await response.json()).code, test.failed ? 'MFA_CHECK_FAILED' : 'MFA_REQUIRED');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  }
}

let consumers = 0;
let integrations = 0;
for (const dir of readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory() || dir.name.startsWith('_')) continue;
  let source;
  try { source = readFileSync(new URL(`${dir.name}/index.ts`, root), 'utf8'); } catch { continue; }
  if (!source.includes('checkAal2Required')) continue;
  consumers++;
  for (const test of cases) {
    let handler;
    let bodyReads = 0;
    const calls = [];
    const token = 'Bearer test-caller-jwt';
    const client = (options) => ({
      auth: { getUser: async () => ({ data: { user: { id: 'caller' } }, error: null }) },
      from(table) {
        assert.equal(table, 'users', `${dir.name}: business access before MFA`);
        const query = {
          select() { return query; }, eq() { return query; },
          async maybeSingle() { return { data: { role: 'admin', is_super_admin: true }, error: null }; },
          async single() { return query.maybeSingle(); },
        };
        return query;
      },
      rpc(name) {
        assert.equal(options?.global?.headers?.Authorization, token, `${dir.name}: caller JWT`);
        return rpcFor(test, calls)(name);
      },
    });
    evaluate(source.replace(/^import\s[^\n]*\n/gm, ''), {
      ...helper,
      authorizeCfdiRequest: async () => ({ allowed: true, caller: { isServiceRole: false, isAdmin: true, userId: 'caller' } }),
      createClient: (_url, _key, options) => client(options),
      Deno: { env: { get: (key) => key === 'SENTRY_BACKEND_DSN' ? undefined : 'test-value' }, serve(fn) { handler = fn; } },
      Sentry: { captureException() {} },
    });
    const response = await handler({
      method: 'POST', headers: new Headers({ Authorization: token }),
      async json() { bodyReads++; throw new Error('stop after successful MFA'); },
    });
    assert.equal(bodyReads, test.allowed ? 1 : 0, `${dir.name}: body access`);
    assert.equal(calls.length, test.responses.length, `${dir.name}: RPC calls`);
    if (!test.allowed) {
      assert.equal(response.status, test.failed ? 503 : 403, dir.name);
      assert.equal((await response.json()).code, test.failed ? 'MFA_CHECK_FAILED' : 'MFA_REQUIRED', dir.name);
    }
    integrations++;
  }
}
assert.equal(consumers, 14, 'Update coverage when MFA consumers change');
console.log(`MFA: ${cases.length} helper cases and ${integrations} handler cases across ${consumers} consumers passed.`);
