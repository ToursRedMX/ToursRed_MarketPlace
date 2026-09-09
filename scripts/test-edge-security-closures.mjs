import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = name => readFileSync(`supabase/functions/${name}.ts`, 'utf8');
const compile = source => ts.transpileModule(source.replace(/^import[^\n]*\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const quiet = { log() {}, warn() {}, error() {} };
let cases = 0;
for (const name of ['generate-credit-note-for-item-cancellation', 'substitute-cfdi-for-partial-cancellation', 'sync-booking-to-accounting']) {
  const accounting = name === 'sync-booking-to-accounting';
  for (const test of [
    { token: '', denied: 401 }, { token: 'anon', noUser: true, denied: 401 },
    { token: 'user', role: 'traveler', denied: accounting ? 403 : 401 },
    { token: 'user', role: 'admin', denied: accounting ? 0 : 401 },
    { token: 'user', role: 'admin', profileError: true, denied: accounting ? 503 : 401 },
    { token: 'user', role: 'admin', mfa: false, denied: accounting ? 403 : 401 },
    { token: 'user', role: 'admin', rpcError: true, denied: accounting ? 503 : 401 },
    { token: 'service', denied: 0 }, { token: 'service', missingKey: true, noUser: true, denied: 401 },
  ]) {
    let handler, bodyReads = 0, businessReads = 0, accountingWrites = 0;
    const context = vm.createContext({ exports: {}, Response, console: quiet,
      Deno: { env: { get: key => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: test.missingKey ? undefined : 'service', SUPABASE_ANON_KEY: 'anon' })[key] }, serve(fn) { handler = fn; } },
      createClient(url, key, options) { return {
        auth: { async getUser() { return { data: { user: test.noUser ? null : { id: 'caller' } }, error: null }; } },
        from(table) {
          if (table !== 'users') businessReads++;
          const q = { select() { return q; }, eq() { return q; }, async maybeSingle() { return { data: table === 'users' ? { role: test.role } : table === 'platform_settings' ? { accounting_sync_enabled: true, accounting_provider: 'internal' } : null, error: test.profileError ? {} : null }; } };
          return q;
        },
        async rpc(fn) {
          if (fn === 'create_accounting_entry_for_booking') {
            assert.equal(key, 'service'); accountingWrites++;
            return { data: 'entry', error: null };
          }
          assert.equal(options.global.headers.Authorization, 'Bearer user');
          return { data: fn === 'requires_aal2_check' ? true : test.mfa ?? true, error: test.rpcError ? {} : null };
        },
      }; },
    });
    // Separate module scopes, with the real helper exports shared by the handler.
    for (const helper of ['auth', 'cfdiAuth', 'aal2Check']) {
      vm.runInContext(`(function(){${compile(read('_shared/' + helper))}})()`, context);
      Object.assign(context, context.exports);
    }
    vm.runInContext(`(function(){${compile(read(name + '/index'))}})()`, context);
    const response = await handler({ method: 'POST', headers: new Headers(test.token ? { Authorization: 'Bearer ' + test.token } : {}), async json() { bodyReads++; return accounting ? { booking_id: 'booking' } : {}; } });
    if (test.denied) { assert.equal(response.status, test.denied, name); assert.equal(bodyReads, 0); assert.equal(businessReads, 0); }
    else { assert.equal(bodyReads, 1, name); if (accounting) assert.equal(accountingWrites, 1); }
    cases++;
  }
}

for (const test of [
  { token: '', status: 400 }, { token: 'token', status: 200 },
  { token: 'token', success: false, status: 400 },
  { token: 'token', success: 'true', status: 400 },
  { token: 'token', httpError: true, status: 503 },
  { token: 'token', throws: true, status: 503 },
  { token: 'token', missingSecret: true, status: 503 },
  { token: 'token', settingsError: true, status: 503 },
  { token: 'token', missingSettings: true, status: 503 },
  { token: 'token', rateError: true, status: 503 },
  { token: 'token', count: 3, status: 429 },
  { enabled: false, status: 200 },
]) {
  let handler, inserts = 0, emails = 0, verifications = 0;
  const qFor = table => {
    const q = { select() { return q; }, eq(column, value) { if (column === 'email') assert.equal(value, 'person@example.com'); return q; }, gte() { return q; },
      insert() { inserts++; return q; }, async single() { return { data: { id: 'inquiry' }, error: null }; },
      async maybeSingle() { return { data: table === 'platform_settings' ? test.missingSettings ? null : { turnstile_auth_enabled: test.enabled ?? true } : { smtp_api_key: 'smtp', contact_email: 'admin@example.com' }, error: test.settingsError ? {} : null }; },
      then(resolve, reject) { return Promise.resolve({ count: test.count ?? 0, error: test.rateError ? {} : null }).then(resolve, reject); },
    }; return q;
  };
  vm.runInNewContext(compile(read('send-inquiry-email/index')), { exports: {}, Response, URLSearchParams, AbortSignal, console: quiet,
    Deno: { env: { get: key => key === 'SENTRY_BACKEND_DSN' ? undefined : key === 'TURNSTILE_SECRET_KEY' && test.missingSecret ? undefined : 'configured' }, serve(fn) { handler = fn; } },
    createClient: () => ({ from: qFor }),
    async fetch(url, options) {
      if (url.includes('siteverify')) {
        verifications++;
        assert.equal(options.body.get('response'), 'token');
        assert.equal(options.redirect, 'error');
        assert.ok(options.signal);
        if (test.throws) throw Error('timeout');
        return new Response(JSON.stringify({ success: test.success ?? true }), { status: test.httpError ? 500 : 200 });
      }
      assert.equal(url, 'https://api.smtp2go.com/v3/email/send');
      emails++;
      return new Response(JSON.stringify({ data: {} }));
    },
  });
  const response = await handler(new Request('https://handler.test', { method: 'POST', body: JSON.stringify({ name: 'Person', email: ' Person@Example.com ', phone: '5555555555', destination: 'Trip', num_people: 2, turnstile_token: test.token }) }));
  assert.equal(response.status, test.status, JSON.stringify(test));
  assert.equal(inserts, test.status === 200 ? 1 : 0);
  assert.equal(emails, test.status === 200 ? 2 : 0);
  if (test.enabled === false) assert.equal(verifications, 0);
  cases++;
}
console.log(`Four security closures: ${cases} scenarios passed without real email, accounting or fiscal operations.`);

let formCases = 0;
for (const page of ['ExoticcaPage', 'MegaTravelPage', 'NefertariTravelPage']) {
  const source = readFileSync(`src/pages/international/${page}.tsx`, 'utf8');
  const ast = ts.createSourceFile(page + '.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let submit;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleSubmit') submit = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(submit);
  for (const test of [{ token: '', calls: 0 }, { token: 'valid', loading: true, calls: 0 }, { token: 'valid', calls: 1 }, { token: 'valid', fail: true, calls: 1 }]) {
    let requests = 0, reset = false, remounted = false;
    const context = vm.createContext({
      turnstileEnabled: true, captchaLoading: test.loading ?? false, turnstileToken: test.token,
      formData: { name: 'Person', email: 'person@example.com', phone: '5555555555', destination: 'Trip', num_people: 2 },
      user: null, setError() {}, setIsLoading() {}, setSuccess() {}, setTimeout() {},
      setTurnstileToken(value) { assert.equal(value, ''); reset = true; },
      setCaptchaAttempt(updater) { assert.equal(updater(0), 1); remounted = true; },
      formPersistence: { clearStorage() {} },
      async fetch(url, options) {
        requests++;
        assert.equal(JSON.parse(options.body).turnstile_token, 'valid');
        return { ok: !test.fail, async json() { return {}; } };
      },
    });
    const expression = submit.replace(/import\.meta\.env\.\w+/g, "'test'");
    const handler = vm.runInContext(compile('(' + expression + ')'), context);
    await handler({ preventDefault() {} });
    assert.equal(requests, test.calls, page);
    assert.equal(reset, test.calls === 1, page);
    assert.equal(remounted, test.calls === 1, page);
    formCases++;
  }
}
console.log(`Inquiry forms: ${formCases} submit scenarios passed across all three callers.`);
