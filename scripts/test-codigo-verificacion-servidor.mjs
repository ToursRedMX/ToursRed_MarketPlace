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
        const email = test.userEmail === undefined ? 'persona@example.com' : test.userEmail;
        return { data: { email, first_name: 'Persona', last_name: 'Prueba', verification_code_expires_at: test.expiresAt ?? null }, error: null };
      },
    };
    // `.update(...).eq(...)` se resuelve como thenable, sin pasar por `.single()`.
    q.then = (resolve) => resolve({ error: test.updateFails ? {} : null });
    return q;
  };
}

async function run(test) {
  let handler;
  const state = { savedCode: null, updateCalls: 0, emailSent: null, emailTo: null, metaCalls: [], rpcCalls: [] };

  const context = vm.createContext({
    exports: {},
    Response,
    console: quiet,
    crypto,
    // Las lineas `import` se borran antes de compilar (ver mas abajo); lo que
    // importaban queda como identificador libre, no como una llamada a
    // require(). Por eso van aqui como globals del contexto, no en un mock
    // de require() -- ese mock nunca hizo nada, y no se habia notado porque
    // ningun escenario disparaba la excepcion que lo necesitaba.
    mensajeDeError: (e) => String(e?.message ?? e),
    opcionesConContexto: (_req, extra) => extra ?? {},
    sinUserAgentDeNavegador: (opts) => opts,
    Deno: {
      env: { get: (key) => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service' })[key] },
      serve(fn) { handler = fn; },
    },
    createClient() {
      return {
        auth: {
          async getUser(token) {
            if (test.noUser) return { data: { user: null }, error: {} };
            return { data: { user: { id: token === 'other' ? 'other-user' : 'caller', app_metadata: test.appMetadata ?? {} } }, error: null };
          },
          admin: {
            async updateUserById(id, attrs) {
              state.metaCalls.push({ id, attrs });
              return { error: test.metaFails ? { message: 'fallo' } : null };
            },
          },
        },
        async rpc(name, args) {
          state.rpcCalls.push({ name, args });
          if (test.availabilityErrors) return { data: null, error: { message: 'no disponible' } };
          return { data: test.emailAvailable ?? true, error: null };
        },
        from: makeFrom(test, state),
      };
    },
    async fetch(url, init) {
      assert.equal(url, 'https://api.smtp2go.com/v3/email/send');
      state.emailSent = state.savedCode;
      state.emailTo = JSON.parse(init.body).to;
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

// --- Cuenta social SIN correo (X, a veces Facebook/Microsoft) ---------------------------
// El trigger sync_user_email deja users.email en NULL, asi que el correo que escribio la
// persona viaja en el cuerpo y se guarda en app_metadata (solo el servidor escribe ahi).
{
  const { response, savedCode, emailTo, metaCalls } = await run({ userEmail: null, extraBody: { email: '  Nuevo@Ejemplo.COM ' } });
  assert.equal(response.status, 200);
  assert.deepEqual(emailTo, ['nuevo@ejemplo.com'], 'el codigo va al correo capturado, normalizado');
  assert.match(savedCode, /^\d{6}$/);
  assert.equal(metaCalls.length, 1);
  assert.equal(metaCalls[0].attrs.app_metadata.pending_contact_email, 'nuevo@ejemplo.com');
  cases++;
}

// Sin correo en el cuerpo y sin uno pendiente, no hay a donde mandar nada.
{
  const { response, updateCalls, emailTo } = await run({ userEmail: null });
  assert.equal(response.status, 400);
  assert.equal(updateCalls, 0);
  assert.equal(emailTo, null);
  cases++;
}

// Un correo mal formado no genera codigo ni toca app_metadata.
{
  const { response, updateCalls, metaCalls } = await run({ userEmail: null, extraBody: { email: 'no-es-un-correo' } });
  assert.equal(response.status, 400);
  assert.equal(updateCalls, 0);
  assert.equal(metaCalls.length, 0);
  cases++;
}

// Reenvio: el correo pendiente ya esta en app_metadata y no hace falta mandarlo otra vez.
{
  const { response, emailTo, metaCalls } = await run({ userEmail: null, appMetadata: { pending_contact_email: 'guardado@ejemplo.com' } });
  assert.equal(response.status, 200);
  assert.deepEqual(emailTo, ['guardado@ejemplo.com']);
  assert.equal(metaCalls.length, 0, 'no reescribe app_metadata si no cambio');
  cases++;
}

// Sin limite, cualquier sesion podria pedir codigos sin parar a cualquier direccion.
{
  const hace10s = new Date(Date.now() + 24 * 3600 * 1000 - 10_000).toISOString();
  const { response, updateCalls, emailTo } = await run({ userEmail: null, extraBody: { email: 'a@b.co' }, expiresAt: hace10s });
  assert.equal(response.status, 429);
  assert.equal(updateCalls, 0);
  assert.equal(emailTo, null);
  cases++;
}
{
  const hace2min = new Date(Date.now() + 24 * 3600 * 1000 - 120_000).toISOString();
  const { response } = await run({ userEmail: null, extraBody: { email: 'a@b.co' }, expiresAt: hace2min });
  assert.equal(response.status, 200, 'pasado el minuto se puede reenviar');
  cases++;
}

// Un correo que ya es de otra cuenta no recibe codigo, ni queda guardado como pendiente.
{
  const { response, updateCalls, emailTo, metaCalls } = await run({ userEmail: null, extraBody: { email: 'ocupado@ejemplo.com' }, emailAvailable: false });
  assert.equal(response.status, 409);
  assert.equal(updateCalls, 0);
  assert.equal(emailTo, null);
  assert.equal(metaCalls.length, 0);
  cases++;
}

// Si la consulta de disponibilidad falla no se bloquea el alta (verify-email-code la repite).
{
  const { response } = await run({ userEmail: null, extraBody: { email: 'a@b.co' }, availabilityErrors: true });
  assert.equal(response.status, 200);
  cases++;
}

// Si no se puede guardar el correo pendiente, no se manda un codigo que luego no se sabe a quien asociar.
{
  const { response, updateCalls, emailTo } = await run({ userEmail: null, extraBody: { email: 'a@b.co' }, metaFails: true });
  assert.equal(response.status, 500);
  assert.equal(updateCalls, 0);
  assert.equal(emailTo, null);
  cases++;
}

// SEGURIDAD: quien YA tiene correo (registro con correo y contrasena) no puede desviar el
// codigo a otra direccion mandando `email` en el cuerpo, ni tocar app_metadata.
{
  const { response, emailTo, metaCalls, rpcCalls } = await run({ extraBody: { email: 'atacante@ejemplo.com' } });
  assert.equal(response.status, 200);
  assert.deepEqual(emailTo, ['persona@example.com']);
  assert.equal(metaCalls.length, 0);
  assert.equal(rpcCalls.length, 0);
  cases++;
}

console.log(`Codigo de verificacion server-side: ${cases} escenarios.`);
