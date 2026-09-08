// Runs the actual handlers with isolated Auth, database and email dependencies.
// No network calls, users or emails are created.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const outcomes = {
  accepted: () => Response.json({ success: true }),
  unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }),
  serverError: () => Response.json({ error: 'Unavailable' }, { status: 500 }),
  falseSuccess: () => Response.json({ success: false }),
  missingAcknowledgement: () => Response.json({}),
  errorStatusWithSuccessBody: () => Response.json({ success: true }, { status: 500 }),
  invalidJson: () => new Response('<html>upstream error</html>'),
  nullJson: () => Response.json(null),
  networkError: () => { throw new TypeError('fetch failed'); },
  timeout: () => { throw new DOMException('Timed out', 'TimeoutError'); },
};
let passed = 0;
for (const slug of ['convert-lead-to-agency', 'fix-agency-email', 'resend-agency-credentials']) {
  for (const [outcome, respond] of Object.entries(outcomes)) {
    let handler;
    let authWrites = 0;
    let emailCalls = 0;
    let deadline;
    const agency = {
      id: 'agency', user_id: 'agency-user', name: 'Test Agency',
      contact_email: 'agency@example.invalid', account_executive_id: 'exec',
      onboarding_status: 'pending_documents',
    };
    const client = {
      auth: {
        getUser: async () => ({ data: { user: { id: 'caller' } }, error: null }),
        admin: {
          createUser: async () => {
            authWrites++;
            return { data: { user: { id: 'agency-user' } }, error: null };
          },
          updateUserById: async () => { authWrites++; return { error: null }; },
          deleteUser: () => { throw new Error('Must not roll back Auth on email failure'); },
        },
      },
      from(table) {
        const query = {
          select() { return query; }, eq() { return query; },
          insert() { return query; }, update() { return query; },
          delete() { throw new Error('Must not roll back data on email failure'); },
          single: async () => ({ data: agency, error: null }),
          maybeSingle: async () => ({
            data: table === 'users' ? { role: 'account_executive' }
              : table === 'account_executives' ? {
                id: 'exec', is_active: true, first_name: 'Test', email: 'exec@example.invalid',
              } : table === 'agencies' ? agency
                : { contact_first_name: 'Test', contact_last_name: 'Agency' },
            error: null,
          }),
          then(resolve, reject) {
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
          },
        };
        return query;
      },
    };
    const source = readFileSync(`supabase/functions/${slug}/index.ts`, 'utf8');
    const code = ts.transpileModule(source.replace(/^import .*;\r?$/gm, ''), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      exports: {}, Request, Response,
      console: { log() {}, warn() {}, error() {} },
      AbortSignal: { timeout(ms) { deadline = ms; return new AbortController().signal; } },
      Deno: {
        env: { get: name => ({
          SUPABASE_URL: 'https://project.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
        })[name] },
        serve: fn => { handler = fn; },
      },
      createClient: () => client,
      fetch: async (url, init) => {
        emailCalls++;
        assert.equal(url, 'https://project.invalid/functions/v1/send-agency-credentials');
        assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-service');
        const body = JSON.parse(init.body);
        assert.equal(body.email, slug === 'fix-agency-email' ? 'changed@example.invalid' : 'agency@example.invalid');
        assert.equal(body.password.length, 12);
        return respond();
      },
    });
    const response = await handler(new Request('https://project.invalid', {
      method: 'POST', headers: { Authorization: 'Bearer test-user' },
      body: JSON.stringify({
        leadId: 'lead', agencyId: 'agency', agencyName: 'Test Agency',
        contactEmail: 'agency@example.invalid', contactFirstName: 'Test',
        personaType: 'persona_fisica', representanteLegalNombre: 'Test',
        newEmail: 'changed@example.invalid',
      }),
    }));
    const result = await response.json();
    assert.equal(response.status, 200, `${slug}/${outcome}: mutation remains successful`);
    assert.equal(result.success, true);
    assert.equal(result.emailSent, outcome === 'accepted', `${slug}/${outcome}: acknowledgement`);
    assert.equal(authWrites, 1, 'Never repeat account creation/password reset');
    assert.equal(emailCalls, 1, 'No automatic email retries');
    assert.equal(deadline, 15000);
    if (slug === 'convert-lead-to-agency') assert.equal(result.agencyId, 'agency');
    if (slug === 'fix-agency-email') assert.equal(result.newEmail, 'changed@example.invalid');
    if (slug === 'resend-agency-credentials') assert.equal(result.email, 'agency@example.invalid');
    passed++;
  }
}
console.log(`${passed} agency credentials email checks passed (isolated; no external effects).`);
