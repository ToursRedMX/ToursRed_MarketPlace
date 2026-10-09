// Registro social SIN correo (X, a veces Facebook/Microsoft): la cuenta de auth no tiene
// email y el trigger sync_user_email deja users.email en NULL, asi que el correo que escribio
// la persona espera en app_metadata.pending_contact_email (lo escribe send-verification-email).
//
// verify-email-code tiene que asociarlo a la cuenta de auth ANTES de marcarlo verificado:
//   - si no, el correo "verificado" no serviria para iniciar sesion ni recuperar la contrasena;
//   - el email de auth es unico, asi que un correo de OTRA cuenta debe fallar sin quedar verificado;
//   - una cuenta que ya tiene correo (registro con correo y contrasena) no se toca.
// Esta prueba corre el handler real de verify-email-code.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('supabase/functions/verify-email-code/index.ts', 'utf8');
const compiled = ts.transpileModule(source.replace(/^import[^\n]*\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const quiet = { log() {}, warn() {}, error() {} };

async function run(test) {
  let handler;
  const calls = []; // en orden: lo que importa es que auth se asocie ANTES de marcar verificado
  const context = vm.createContext({
    exports: {},
    Response,
    console: quiet,
    crypto,
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
          async getUser() {
            return { data: { user: { id: 'caller', email: test.authEmail, app_metadata: test.appMetadata ?? { provider: 'facebook' } } }, error: null };
          },
          admin: {
            async updateUserById(id, attrs) {
              calls.push({ tipo: 'auth', id, attrs });
              return { error: test.adminFails ? { message: 'email_exists' } : null };
            },
          },
        },
        from(table) {
          assert.equal(table, 'users');
          const q = {
            select() { return q; },
            eq() { return q; },
            update(values) { calls.push({ tipo: 'users', values }); return q; },
            async single() {
              const email = test.userEmail === undefined ? null : test.userEmail;
              return {
                data: {
                  id: 'caller', email, verification_code: '123456',
                  verification_code_expires_at: new Date(Date.now() + 3600_000).toISOString(),
                  verification_code_attempts: 0, email_verified: false,
                },
                error: null,
              };
            },
          };
          q.then = (resolve) => resolve({ error: null });
          return q;
        },
      };
    },
  });
  vm.runInContext(compiled, context);
  const response = await handler({
    method: 'POST',
    headers: new Headers({ Authorization: 'Bearer user' }),
    async json() { return { code: test.code ?? '123456' }; },
  });
  return { response, body: await response.json(), calls };
}

const authCalls = (calls) => calls.filter((c) => c.tipo === 'auth');
// Los objetos nacen en otro contexto de vm (otro prototipo): se comparan por su JSON.
const plano = (valor) => JSON.parse(JSON.stringify(valor));
const verificado = (calls) => calls.some((c) => c.tipo === 'users' && c.values.email_verified === true);
let cases = 0;

// Cuenta social sin correo: se asocia el pendiente y DESPUES se marca verificado.
{
  const { response, calls } = await run({ appMetadata: { provider: 'facebook', pending_contact_email: 'nuevo@ejemplo.com' } });
  assert.equal(response.status, 200);
  assert.equal(authCalls(calls).length, 1);
  assert.deepEqual(plano(authCalls(calls)[0].attrs), {
    email: 'nuevo@ejemplo.com',
    email_confirm: true,
    app_metadata: { provider: 'facebook', pending_contact_email: null },
  });
  const iAuth = calls.findIndex((c) => c.tipo === 'auth');
  const iUsers = calls.findIndex((c) => c.tipo === 'users' && c.values.email_verified === true);
  assert.ok(iAuth >= 0 && iUsers > iAuth, 'el correo se asocia a auth ANTES de marcarlo verificado');
  cases++;
}

// Un correo que ya es de otra cuenta: falla, y la persona NO queda verificada.
{
  const { response, body, calls } = await run({ appMetadata: { pending_contact_email: 'ocupado@ejemplo.com' }, adminFails: true });
  assert.equal(response.status, 409);
  assert.equal(body.success, false);
  assert.equal(verificado(calls), false, 'no debe quedar verificado si el correo no se pudo asociar');
  cases++;
}

// Registro con correo y contrasena: la cuenta ya tiene correo y no se toca.
{
  const { response, calls } = await run({ authEmail: 'persona@example.com', userEmail: 'persona@example.com', appMetadata: {} });
  assert.equal(response.status, 200);
  assert.equal(authCalls(calls).length, 0, 'no debe reescribir el correo de una cuenta que ya lo tiene');
  assert.equal(verificado(calls), true);
  cases++;
}

// Codigo equivocado: no se asocia nada.
{
  const { response, calls } = await run({ code: '000000', appMetadata: { pending_contact_email: 'nuevo@ejemplo.com' } });
  assert.equal(response.status, 400);
  assert.equal(authCalls(calls).length, 0, 'un codigo incorrecto no debe asociar el correo');
  assert.equal(verificado(calls), false);
  cases++;
}

// Sin correo en ningun lado no hay nada que verificar.
{
  const { response, calls } = await run({ appMetadata: { provider: 'facebook' } });
  assert.equal(response.status, 400);
  assert.equal(authCalls(calls).length, 0);
  assert.equal(verificado(calls), false);
  cases++;
}

// Respaldo: sin pendiente en app_metadata, se usa el de `users` si lo hubiera.
{
  const { response, calls } = await run({ userEmail: 'respaldo@ejemplo.com' });
  assert.equal(response.status, 200);
  assert.equal(authCalls(calls)[0].attrs.email, 'respaldo@ejemplo.com');
  cases++;
}

console.log(`Correo pendiente de registro social: ${cases} escenarios.`);
