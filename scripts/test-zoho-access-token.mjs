import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/_shared/zohoAccessToken.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const expired = { access_token: 'old-token', refresh_token: 'private-refresh', access_token_expires_at: '2020-01-01', api_domain: 'https://www.zohoapis.com' };
const validResponse = { access_token: 'new-token', expires_in: 3600, api_domain: 'https://www.zohoapis.com' };
const scenarios = [
  { name: 'cached', row: { ...expired, access_token_expires_at: '2099-01-01' }, cached: true },
  { name: 'refresh' },
  { name: 'invalid date refreshes', row: { ...expired, access_token_expires_at: 'invalid' } },
  { name: 'empty access token refreshes', row: { ...expired, access_token: '' } },
  { name: 'optional response fields', response: { access_token: 'new-token' } },
  { name: 'missing token', row: null, fail: true },
  { name: 'token query error', queryError: 'zoho_oauth_tokens', fail: true },
  { name: 'settings query error', queryError: 'platform_settings', fail: true },
  { name: 'secrets query error', queryError: 'platform_secrets', fail: true },
  { name: 'missing settings', missing: 'platform_settings', fail: true },
  { name: 'missing secrets', missing: 'platform_secrets', fail: true },
  { name: 'missing refresh token', row: { ...expired, refresh_token: '' }, fail: true },
  { name: 'untrusted region', region: 'com.evil.test', fail: true },
  { name: 'untrusted stored domain', row: { ...expired, api_domain: 'https://evil.test' }, fail: true },
  { name: 'HTTP failure', httpError: true, fail: true, fetched: true },
  { name: 'network failure', networkError: true, fail: true, fetched: true },
  { name: 'timeout', timeout: true, fail: true, fetched: true },
  { name: 'invalid JSON', invalidJson: true, fail: true, fetched: true },
  { name: 'persistence failure', saveError: true, fail: true, fetched: true, saved: true },
];
for (const response of [null, [], {}, { error: 'invalid_client' }, { ...validResponse, access_token: '' }, { ...validResponse, expires_in: 0 }, { ...validResponse, expires_in: -1 }, { ...validResponse, expires_in: 'bad' }, { ...validResponse, expires_in: 1e100 }, { ...validResponse, api_domain: 'https://www.zohoapis.com.evil.test' }]) {
  scenarios.push({ name: 'invalid OAuth response', response, fail: true, fetched: true });
}
for (const region of ['com', 'eu', 'in', 'com.au', 'jp']) scenarios.push({ name: `configured region ${region}`, region });
for (const test of scenarios) {
  const reads = [], writes = [], requests = [];
  const client = { from(table) {
    reads.push(table);
    const row = Object.hasOwn(test, 'row') ? test.row : expired;
    const data = test.missing === table ? null : table === 'zoho_oauth_tokens' ? row : table === 'platform_settings' ? { zoho_client_id: 'client-id', zoho_region: test.region || 'com' } : { zoho_client_secret: 'private-secret' };
    const query = {
      select(columns) {
        if (table === 'platform_settings') assert.ok(!columns.includes('zoho_client_secret'));
        return query;
      },
      order() { return query; }, limit() { return query; },
      async maybeSingle() { return { data, error: test.queryError === table ? { message: 'private-query-error' } : null }; },
      update(value) { writes.push(value); return query; },
      async eq(column, value) { assert.equal(column, 'refresh_token'); assert.equal(value, 'private-refresh'); return { error: test.saveError ? { message: 'private-save-error' } : null }; },
    };
    return query;
  } };
  const context = { exports: {}, URL, URLSearchParams, Date, AbortSignal: {
    timeout(ms) {
      assert.equal(ms, 15000);
      const controller = new AbortController();
      if (test.timeout) setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), 5);
      return controller.signal;
    },
  }, fetch: async (url, options) => {
    requests.push({ url, options });
    assert.equal(url, `https://accounts.zoho.${test.region || 'com'}/oauth/v2/token`);
    assert.equal(options.redirect, 'error');
    assert.equal(options.body.get('client_secret'), 'private-secret');
    assert.equal(options.body.get('refresh_token'), 'private-refresh');
    if (test.timeout) await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    if (test.networkError) throw new Error('private-network-error');
    return { ok: !test.httpError, async json() {
      if (test.invalidJson) throw new Error('private-json-error');
      return Object.hasOwn(test, 'response') ? test.response : validResponse;
    } };
  } };
  vm.runInNewContext(compiled, context);
  if (test.fail) {
    await assert.rejects(context.exports.getZohoAccessToken(client), error => !error.message.includes('private-'), test.name);
    assert.equal(writes.length, test.saved ? 1 : 0, test.name);
    assert.equal(requests.length, test.fetched ? 1 : 0, test.name);
  } else {
    const result = await context.exports.getZohoAccessToken(client);
    assert.equal(result.token, test.cached ? 'old-token' : 'new-token');
    assert.equal(result.apiDomain, expired.api_domain);
    assert.equal(requests.length, test.cached ? 0 : 1);
    assert.equal(writes.length, test.cached ? 0 : 1);
    if (test.cached) assert.deepEqual(reads, ['zoho_oauth_tokens']);
    else assert.ok(Date.parse(writes[0].access_token_expires_at) > Date.now());
  }
}

// All seven real consumers must acquire a token before reaching their Books call.
let consumers = 0;
for (const name of ['cancel-cfdi', 'generate-booking-cfdi', 'generate-booking-installment-cfdi', 'generate-cancellation-commission-cfdi', 'generate-commission-cfdi', 'generate-membership-cfdi', 'sync-to-accounting']) {
  const source = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const candidates = ast.statements.filter(node => ts.isFunctionDeclaration(node) && /^(zohoBooks|createZohoBooksAdapter)/.test(node.name?.text || ''));
  assert.equal(candidates.length, 1, name);
  const fn = candidates[0];
  const code = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let tokenCalls = 0;
  const failure = new Error('refresh blocked');
  const context = { getZohoAccessToken: async () => { tokenCalls++; throw failure; }, fetch: () => { throw new Error('Books called after refresh failure'); } };
  vm.runInNewContext(code, context);
  if (name === 'sync-to-accounting') {
    const nested = fn.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'zhFetch');
    assert.ok(nested);
    context.supabase = {};
    context.orgId = 'org';
    vm.runInNewContext(ts.transpileModule(nested.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    await assert.rejects(context.zhFetch('/invoices', 'POST', {}), error => error === failure);
    assert.equal(tokenCalls, 1);
  } else {
    await assert.rejects(context[fn.name.text]({}, 'org'), error => error === failure);
    assert.equal(tokenCalls, 1);
  }
  consumers++;
}
console.log(`Zoho: ${scenarios.length} token cases passed; ${consumers} consumers checked. No real OAuth or database calls.`);
