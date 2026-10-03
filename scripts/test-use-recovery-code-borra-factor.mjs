// El sistema de codigos de recuperacion de MFA generaba codigos
// (generate-recovery-codes) que nadie podia usar: `use-recovery-code`
// existia pero ningun archivo del front lo llamaba, y aunque se llamara,
// validar el codigo no elevaba la sesion a AAL2 -- esa elevacion solo la da
// Supabase al completar un reto TOTP real. Pendiente 10 de la entrada 33.
//
// El arreglo: tras validar el codigo, se borran los factores TOTP
// `verified` del usuario (admin.mfa.deleteFactor), asi que el siguiente
// login lo manda derecho a "needs_enrollment" en vez de pedirle otra vez el
// dispositivo que ya perdio. Esta prueba corre el handler real con `vm` y
// confirma ese borrado -- y que NO se borra nada si el codigo es invalido.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('supabase/functions/use-recovery-code/index.ts', 'utf8');
const compiled = ts.transpileModule(source.replace(/^import[^\n]*\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const quiet = { log() {}, warn() {}, error() {} };

async function run(test) {
  let handler;
  const state = {
    deleteFactorCalls: [],
    failedAttemptsInserted: 0,
    successAttemptsInserted: 0,
    auditLogged: false,
  };

  const context = vm.createContext({
    exports: {},
    Response,
    console: quiet,
    crypto,
    TextEncoder,
    mensajeDeError: (e) => String(e?.message ?? e),
    opcionesConContexto: (_req, extra) => extra ?? {},
    sinUserAgentDeNavegador: (opts) => opts,
    Deno: {
      env: {
        get: (key) => ({
          SUPABASE_URL: 'https://db.test',
          SUPABASE_SERVICE_ROLE_KEY: 'service',
          SUPABASE_ANON_KEY: 'anon',
          MFA_RECOVERY_PEPPER: 'test-pepper',
        })[key],
      },
      serve(fn) { handler = fn; },
    },
    createClient(_url, key) {
      const esAdmin = key === 'service';
      return {
        auth: {
          async getUser() {
            if (test.noUser) return { data: { user: null }, error: {} };
            return { data: { user: { id: 'caller' } }, error: null };
          },
          mfa: {
            async listFactors() {
              return {
                data: {
                  totp: test.factores ?? [
                    { id: 'factor-1', status: 'verified' },
                  ],
                },
              };
            },
          },
          admin: esAdmin ? {
            mfa: {
              async deleteFactor({ id, userId }) {
                state.deleteFactorCalls.push({ id, userId });
                return { error: null };
              },
            },
          } : undefined,
        },
        from(table) {
          const q = {
            select() { return q; },
            eq() { return q; },
            is() { return q; },
            limit() { return q; },
            gte() { return q; },
            async maybeSingle() { return { data: { role: 'admin', email: 'a@a.com' }, error: null }; },
            update() { return q; },
            insert(row) {
              if (table === 'auth_attempts') {
                if (row.success) state.successAttemptsInserted++;
                else state.failedAttemptsInserted++;
              }
              return q;
            },
          };
          if (table === 'auth_attempts') {
            // select(...).eq(...).eq(...).eq(...).gte(...) -- cuenta de intentos fallidos
            q.then = (resolve) => resolve({ count: test.intentosFallidosPrevios ?? 0 });
          }
          if (table === 'mfa_recovery_codes') {
            // update(...).eq(...).eq(...).is(...).select(...).limit(...)
            q.then = (resolve) => resolve({
              data: test.codigoValido ? [{ id: 'codigo-1' }] : [],
              error: null,
            });
          }
          return q;
        },
        async rpc() {
          state.auditLogged = true;
          return { data: null, error: null };
        },
      };
    },
  });
  vm.runInContext(compiled, context);

  const response = await handler({
    method: 'POST',
    headers: new Headers(test.sinAuth ? {} : { Authorization: 'Bearer user' }),
    async json() { return { code: test.code ?? 'TR-ABCD-EFGH-IJKL' }; },
  });
  const body = await response.json();
  return { response, body, ...state };
}

let casos = 0;

// Codigo valido, un factor verified: se borra y se audita.
{
  const { response, body, deleteFactorCalls, successAttemptsInserted, auditLogged } =
    await run({ codigoValido: true });
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(deleteFactorCalls.length, 1, 'deberia borrar el unico factor verified');
  assert.deepEqual(deleteFactorCalls[0], { id: 'factor-1', userId: 'caller' });
  assert.equal(successAttemptsInserted, 1);
  assert.ok(auditLogged, 'deberia dejar rastro en insert_audit_log');
  casos++;
}

// Dos factores verified (ej. "Agregar otro factor" en Seguridad): se borran los dos.
{
  const { deleteFactorCalls } = await run({
    codigoValido: true,
    factores: [
      { id: 'factor-1', status: 'verified' },
      { id: 'factor-2', status: 'verified' },
      { id: 'factor-3', status: 'unverified' }, // huerfano, no se toca
    ],
  });
  assert.equal(deleteFactorCalls.length, 2, 'solo los verified, no el huerfano unverified');
  assert.deepEqual(deleteFactorCalls.map(c => c.id).sort(), ['factor-1', 'factor-2']);
  casos++;
}

// Codigo invalido o ya usado: NO se borra nada, se registra el intento fallido.
{
  const { response, body, deleteFactorCalls, failedAttemptsInserted } =
    await run({ codigoValido: false });
  assert.equal(response.status, 400);
  assert.equal(body.success, undefined);
  assert.equal(deleteFactorCalls.length, 0, 'un codigo invalido no debe desvincular ningun factor');
  assert.equal(failedAttemptsInserted, 1);
  casos++;
}

// Rate limit: 5 intentos fallidos previos bloquea, sin llegar a mirar el codigo.
{
  const { response, deleteFactorCalls } = await run({ codigoValido: true, intentosFallidosPrevios: 5 });
  assert.equal(response.status, 429);
  assert.equal(deleteFactorCalls.length, 0);
  casos++;
}

// Sin sesion, no hay nada que validar.
{
  const { response, deleteFactorCalls } = await run({ sinAuth: true });
  assert.equal(response.status, 401);
  assert.equal(deleteFactorCalls.length, 0);
  casos++;
}

console.log(`use-recovery-code borra el factor atascado: ${casos} escenarios.`);
