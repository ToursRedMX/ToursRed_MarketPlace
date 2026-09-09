import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const settings = { pac_provider: 'facturapi', pac_organization_id: 'org-test' };
const secrets = { pac_api_key_encrypted: 'test-key' };
const error = { message: 'private database diagnostic' };
const scenarios = [
  { settings: null, secrets, status: 422 },
  { settings, secrets: null, status: 422 },
  { settings, secrets: { pac_api_key_encrypted: '' }, status: 422 },
  { settings: null, secrets: null, status: 422 },
  { settings, secrets, settingsError: error, status: 503 },
  { settings: null, secrets, settingsError: error, status: 503 },
  { settings, secrets, secretsError: error, status: 503 },
  { settings, secrets: null, secretsError: error, status: 503 },
  { settings, secrets, status: 200 },
  { settings: { ...settings, pac_organization_id: null }, secrets, status: 200 },
  { settings, secrets, denied: true, status: 403 },
];
let count = 0;
for (const name of ['download-cfdi', 'cancel-cfdi']) {
  const source = readFileSync(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8');
  for (const test of scenarios) {
    let handler;
    const writes = [];
    const requests = [];
    const reads = [];
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: 'caller' } }, error: null }) },
      from(table) {
        reads.push(table);
        const data = table === 'platform_settings' ? test.settings : table === 'platform_secrets' ? test.secrets :
          table === 'users' ? { role: test.denied ? 'unknown' : 'admin' } :
          table === 'cfdi_invoices' ? { id: 'invoice', pac_invoice_id: 'pac-id', pac_provider: 'facturapi', status: 'stamped' } :
          { id: 'cancellation' };
        const result = { data, error: table === 'platform_settings' ? test.settingsError : table === 'platform_secrets' ? test.secretsError : null };
        const query = {
          select() { return query; }, eq() { return query; },
          insert(value) { writes.push({ table, value }); return query; },
          update(value) { writes.push({ table, value }); return query; },
          async maybeSingle() { return result; }, async single() { return result; },
          then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
        };
        return query;
      },
    };
    vm.runInNewContext(ts.transpileModule(source.replace(/^import[^\n]*\n/gm, ''), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, {
      exports: {}, URL, URLSearchParams, Response, console,
      Deno: { env: { get: key => key === 'SENTRY_BACKEND_DSN' ? undefined : 'test-value' }, serve: fn => { handler = fn; } },
      createClient: () => client,
      authorizeCfdiRequest: async () => test.denied ? { allowed: false, response: new Response(null, { status: 403 }) } : { allowed: true, caller: { userId: 'caller' } },
      fetch: async (url, options) => {
        requests.push({ url, options });
        return new Response(name === 'cancel-cfdi' ? JSON.stringify({ status: 'canceled' }) : 'file-bytes');
      },
    });
    const response = await handler(new Request('https://example.test?cfdi_id=invoice&file_type=pdf', {
      method: name === 'cancel-cfdi' ? 'POST' : 'GET', headers: { Authorization: 'Bearer caller-token' },
      ...(name === 'cancel-cfdi' ? { body: JSON.stringify({ cfdi_invoice_id: 'invoice', motivo: '02' }) } : {}),
    }));
    assert.equal(response.status, test.status, `${name}: ${JSON.stringify(test)}`);
    if (test.status !== 200) {
      assert.equal(writes.length, 0, 'No cancellation record or invoice change on config failure');
      assert.equal(requests.length, 0, 'No PAC calls on config failure');
      const body = await response.text();
      assert.ok(!body.includes(error.message), 'No private database diagnostics in response');
      if (test.status === 503) assert.equal(JSON.parse(body).code, 'PAC_CONFIG_UNAVAILABLE');
      if (test.denied) assert.ok(!reads.includes('platform_secrets'), 'Authorization still precedes secrets');
    } else {
      assert.equal(requests.length, 1);
      assert.equal(requests[0].options.headers.Authorization, 'Bearer test-key');
      assert.equal(requests[0].options.headers['X-Organization-Id'], test.settings.pac_organization_id || undefined);
      if (name === 'download-cfdi') {
        assert.equal(await response.text(), 'file-bytes');
        assert.equal(response.headers.get('Content-Type'), 'application/pdf');
      } else assert.equal((await response.json()).cfdi_status, 'cancelled');
    }
    count++;
  }
}
console.log(`CFDI PAC configuration: ${count} handler scenarios passed without real PAC or database calls.`);
