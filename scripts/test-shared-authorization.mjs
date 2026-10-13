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
const denoServicio = { Deno: { env: { get: () => 'service-key' } } };
const { llamadaInterna } = load('auth', { ...denoServicio, Request, Headers });
const cfdi = load('cfdiAuth', { ...denoServicio, llamadaInterna });
const cfdiCases = [
  { token: '', status: 401, calls: 0 },
  { token: 'service-key', status: 200, calls: 0 },
  // verify_jwt = true: el gateway cambia el Bearer por un JWT acunado y la
  // llave solo sobrevive en `apikey`. Hasta el 25-sep-2026 esto daba 401 y
  // cancel-cfdi rechazaba a process-traveler-cancellation.
  { token: 'jwt-acunado-por-el-gateway', apikey: 'service-key', status: 200, calls: 0 },
  { apikey: 'sb_publishable_x', role: 'admin', status: 200 },
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
  const headers = { Authorization: `Bearer ${test.token ?? 'user-token'}` };
  if (test.apikey) headers.apikey = test.apikey;
  const req = new Request('https://example.test', { headers });
  const result = await cfdi.authorizeCfdiRequest(client, req, { ownerUserId: test.owner, resource: 'test' });
  assert.equal(result.allowed ? 200 : result.response.status, test.status);
  assert.equal(authCalls, test.calls ?? 1);
  if (test.status === 503) assert.equal((await result.response.json()).code, 'CFDI_AUTH_UNAVAILABLE');
}

const verified = { totp: [{ id: 'factor', status: 'verified' }] };
// enforceStepUp: el codigo TOTP para GASTAR saldo es de UN SOLO USO (13-oct-2026). La base lo consume
// con `consume_spend_step_up`; aqui `consumed` es lo que esa funcion devuelve. Solo `true` estricto pasa.
const stepCases = [
  { factors: verified, consumed: true, allowed: true },
  { factors: verified, consumed: false, code: 'STEP_UP_REQUIRED' },
  { factors: verified, consumed: null, code: 'STEP_UP_REQUIRED' },
  { factors: verified, consumed: 'true', code: 'STEP_UP_REQUIRED' },
  { factors: verified, consumed: 1, code: 'STEP_UP_REQUIRED' },
  { factors: verified, consumed: [{ id: 'verification' }], code: 'STEP_UP_REQUIRED' },
  { factors: verified, consumed: true, queryError: true, code: 'STEP_UP_REQUIRED' },
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
  const llamadas = [];
  const step = load('stepUpCheck', { createClient(url, key) {
    queries++;
    assert.equal(url, 'https://db.test'); assert.equal(key, 'service-key');
    return {
      // Un solo camino hacia la base: consumir la prueba. NUNCA leer la tabla (`from`), porque una
      // lectura de "existe alguna fila vigente" es justo lo que dejaba reutilizar un codigo.
      from() { throw new Error('checkStepUp no debe leer sensitive_verifications: debe CONSUMIR la prueba'); },
      async rpc(nombre, args) {
        // Se registra y se afirma FUERA: dentro, el try/catch de checkStepUp (que falla cerrado) se
        // tragaria la aserciones y la prueba pasaria por la razon equivocada.
        llamadas.push([nombre, args?.p_user, Object.keys(args ?? {}).join(',')]);
        if (test.queryThrows) throw new Error('query failed');
        return { data: test.consumed, error: test.queryError ? {} : null };
      },
    };
  } });
  const client = { auth: { mfa: { async listFactors() {
    if (test.factorsThrows) throw new Error('MFA unavailable');
    return { data: test.factors, error: test.factorsError ? {} : null };
  } } } };
  const response = await step.enforceStepUp(client, 'service-key', 'https://db.test', test.userId ?? 'caller');
  if (test.allowed) assert.equal(response, null);
  else { assert.equal(response.status, 403); assert.equal((await response.json()).code, test.code); }
  assert.equal(queries, test.noQuery ? 0 : 1);
  if (!test.noQuery) assert.deepEqual(llamadas, [['consume_spend_step_up', 'caller', 'p_user']], 'una sola llamada: consume_spend_step_up({ p_user })');
  else assert.deepEqual(llamadas, []);
}
// ---- gastoDeSaldo: cuando un cobro de RESERVA gasta saldo/puntos y exige el codigo ---------------------
// Un pago MIXTO (saldo o puntos + otro medio) comprometia el saldo en la reserva y el webhook lo
// debitaba sin segundo factor (13-oct-2026). La decision se toma con la reserva.
{
  const sinEfectos = load('gastoDeSaldo', { ...denoServicio });
  const decide = [
    [{ payment_status: 'pending', points_used: 25000, toursred_cash_used: 0 }, true, 'puntos pendientes'],
    [{ payment_status: 'pending', points_used: 0, toursred_cash_used: '250.00' }, true, 'Cash pendiente (viene como texto)'],
    [{ payment_status: 'pending', points_used: 5, toursred_cash_used: '10.50' }, true, 'ambos'],
    [{ payment_status: null, points_used: 100 }, true, 'sin payment_status: aun no se pago'],
    [{ payment_status: 'succeeded', points_used: 25000, toursred_cash_used: '250.00' }, false, 'YA pagada: un suplemento posterior con tarjeta no pide el codigo'],
    [{ payment_status: 'pending', points_used: 0, toursred_cash_used: '0.00' }, false, 'sin saldo ni puntos'],
    [{ payment_status: 'pending', points_used: null, toursred_cash_used: null }, false, 'nulos'],
    [{ payment_status: 'pending', points_used: -5, toursred_cash_used: 'abc' }, false, 'basura no cuenta como saldo'],
    [null, false, 'sin reserva'], [undefined, false, 'indefinida'],
  ];
  for (const [reserva, esperado, que] of decide) assert.equal(sinEfectos.reservaGastaSaldo(reserva), esperado, que);

  const escenarios = [
    { que: 'sin saldo: pasa y NO consulta el MFA', reserva: { payment_status: 'pending' }, userId: 'dueno', auth: 'Bearer x', pasa: true, enforce: 0 },
    { que: 'con saldo y reserva AJENA: 403 sin tocar el MFA', reserva: { payment_status: 'pending', points_used: 10, user_id: 'otro' }, userId: 'dueno', auth: 'Bearer x', status: 403, enforce: 0 },
    { que: 'con saldo sin cabecera Authorization: 401', reserva: { payment_status: 'pending', points_used: 10, user_id: 'dueno' }, userId: 'dueno', auth: null, status: 401, enforce: 0 },
    { que: 'con saldo sin userId: 401', reserva: { payment_status: 'pending', points_used: 10, user_id: 'dueno' }, userId: undefined, auth: 'Bearer x', status: 401, enforce: 0 },
    { que: 'con saldo del dueno: exige el codigo y devuelve su respuesta', reserva: { payment_status: 'pending', points_used: 10, user_id: 'dueno' }, userId: 'dueno', auth: 'Bearer x', status: 403, enforce: 1, bloqueo: true },
    { que: 'con saldo del dueno y codigo valido: pasa', reserva: { payment_status: 'pending', toursred_cash_used: '1', user_id: 'dueno' }, userId: 'dueno', auth: 'Bearer x', pasa: true, enforce: 1 },
    { que: 'reserva sin user_id (solo viene en algunos select): igual exige el codigo', reserva: { payment_status: 'pending', points_used: 10 }, userId: 'dueno', auth: 'Bearer x', status: 403, enforce: 1, bloqueo: true },
  ];
  for (const e of escenarios) {
    let enforce = 0; let args = null;
    const guarda = load('gastoDeSaldo', {
      Deno: { env: { get: (k) => `valor-${k}` } },
      createClient: () => ({ auth: { mfa: {} } }),
      enforceStepUp: async (...a) => { enforce++; args = a; return e.bloqueo ? new Response('{"code":"STEP_UP_REQUIRED"}', { status: 403 }) : null; },
    });
    const req = { headers: { get: (h) => (h === 'Authorization' ? e.auth : null) } };
    const r = await guarda.exigirMfaSiGastaSaldo(req, e.userId, e.reserva);
    if (e.pasa) assert.equal(r, null, e.que); else assert.equal(r.status, e.status, e.que);
    assert.equal(enforce, e.enforce, `${e.que}: veces que se consulta el MFA`);
    if (e.enforce) assert.equal(args[3], e.userId, `${e.que}: el codigo se exige a QUIEN llama`);
  }
}
console.log(`Shared authorization: ${cfdiCases.length + stepCases.length} scenarios (+ gastoDeSaldo) passed without network or business mutations.`);
