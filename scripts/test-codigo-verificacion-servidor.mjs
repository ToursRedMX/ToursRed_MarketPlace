// El codigo de verificacion de correo se generaba en el navegador
// (Math.random) y se escribia directo en `users` antes de pedirle a la
// Edge Function que lo mandara por correo: quien lo generaba ya lo conocia,
// y podia marcar su propio correo como verificado sin haberlo leido nunca.
// Esta prueba corre el handler real de send-verification-email y afirma que
// el codigo sale del servidor, que nunca se devuelve al cliente, y que un
// usuario no puede pedir el codigo de otro.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('supabase/functions/send-verification-email/index.ts', 'utf8');
const compiled = ts.transpileModule(source.replace(/^import[^\n]*\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const quiet = { log() {}, warn() {}, error() {} };

function makeFrom(test, state) {
  return (table) => {
    if (table === 'email_settings') {
      const q = {
        select() { return q; },
        async maybeSingle() { return { data: { smtp_api_key: 'smtp-key', contact_email: 'contacto@toursred.com' }, error: null }; },
      };
      return q;
    }
    assert.equal(table, 'users');
    const q = {
      select() { return q; },
      eq(column, value) { q._id = value; return q; },
      update(values) {
        state.updateCalls++;
        state.savedCode = values.verification_code;
        return q;
      },
      async single() {
        if (test.userNotFound) return { data: null, error: {} };
        return { data: { email: 'persona@example.com', first_name: 'Persona', last_name: 'Prueba' }, error: null };
      },
    };
    // `.update(...).eq(...)` se resuelve como thenable, sin pasar por `.single()`.
    q.then = (resolve) => resolve({ error: test.updateFails ? {} : null });
    return q;
  };
}

async function run(test) {
  let handler;
  const state = { savedCode: null, updateCalls: 0, emailSent: null };

  const context = vm.createContext({
    exports: {},
    Response,
    console: quiet,
    crypto,
    require() { return { mensajeDeError: (e) => String(e?.message ?? e) }; },
    Deno: {
      env: { get: (key) => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[key] },
      serve(fn) { handler = fn; },
    },
    createClient() {
      return {
        auth: {
          async getUser(token) {
            if (test.noUser) return { data: { user: null }, error: {} };
            return { data: { user: { id: token === 'other' ? 'other-user' : 'caller' } }, error: null };
          },
        },
        from: makeFrom(test, state),
      };
    },
    async fetch(url) {
      assert.equal(url, 'https://api.smtp2go.com/v3/email/send');
      state.emailSent = state.savedCode;
      return new Response(JSON.stringify({ data: {} }));
    },
  });
  vm.runInContext(compiled, context);

  const response = await handler({
    method: 'POST',
    headers: new Headers({ Authorization: `Bearer ${test.token ?? 'user'}` }),
    async json() { return { userId: test.userId ?? 'caller', userName: 'Persona', ...(test.extraBody ?? {}) }; },
  });
  const body = await response.json();
  return { response, body, ...state };
}

let cases = 0;

// El cliente nunca manda el codigo: aunque lo intente, el servidor genera el suyo
// y no lo devuelve en la respuesta.
{
  const { response, body, savedCode } = await run({ extraBody: { verificationCode: '000000' } });
  assert.equal(response.status, 200);
  assert.notEqual(savedCode, '000000', 'el codigo guardado no debe ser el que mando el cliente');
  assert.ok(!JSON.stringify(body).includes(savedCode), 'la respuesta no debe revelar el codigo');
  cases++;
}

// El codigo guardado es el que se manda por correo, y nunca viaja en la respuesta.
{
  const { response, body, savedCode, emailSent, updateCalls } = await run({});
  assert.equal(response.status, 200);
  assert.equal(updateCalls, 1);
  assert.match(savedCode, /^\d{6}$/);
  assert.equal(emailSent, savedCode);
  assert.ok(!JSON.stringify(body).includes(savedCode), 'el codigo no debe salir en la respuesta HTTP');
  cases++;
}

// Un usuario no puede pedir el codigo de otro.
{
  const { response, body, updateCalls } = await run({ token: 'other', userId: 'caller' });
  assert.equal(response.status, 403);
  assert.equal(body.success, false);
  assert.equal(updateCalls, 0, 'no debe escribir el codigo de un usuario ajeno');
  cases++;
}

// Sin token valido, no hay generacion.
{
  const { response, updateCalls } = await run({ noUser: true });
  assert.equal(response.status, 401);
  assert.equal(updateCalls, 0);
  cases++;
}

// Si falla el guardado, no se manda el correo con un codigo que no quedo en la base.
{
  const { response, emailSent, updateCalls } = await run({ updateFails: true });
  assert.equal(response.status, 500);
  assert.equal(updateCalls, 1);
  assert.equal(emailSent, null, 'no debe enviar correo si el UPDATE fallo');
  cases++;
}

console.log(`Codigo de verificacion server-side: ${cases} escenarios.`);
