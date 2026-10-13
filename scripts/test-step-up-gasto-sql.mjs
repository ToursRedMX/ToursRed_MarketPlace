/**
 * Prueba de TOTP de UN SOLO USO para gastar saldo/puntos
 * (migracion 20261013031834_step_up_de_gasto_un_solo_uso.sql).
 *
 * LA REGLA (Axel, 13-oct-2026): "que lo pida siempre para poder usar wallet y/o puntos".
 *
 * ============================================================================
 * QUE VIGILA
 * ============================================================================
 *  1. El DEFECTO, reproducido con la logica vieja de checkStepUp ("existe alguna fila vigente"):
 *     el codigo tecleado para CANCELAR una reserva dejaba pagar con wallet un minuto despues.
 *     Una prueba que no se ve fallar no prueba nada.
 *  2. Una prueba de gasto se CONSUME: sirve para un gasto y solo uno.
 *  3. Las pruebas no se mezclan: una 'reauth' no sirve para gastar, una 'spend' no sirve para
 *     reautenticar (cancelar, cambiar telefono).
 *  4. Vencidas, ajenas, de otro `method` o ya consumidas no sirven.
 *  5. Dos codigos = dos gastos; el tercero no.
 *  6. Permisos: solo el service_role ejecuta la funcion; authenticated y anon no.
 *  7. verify-sensitive-action emite 'spend' con 5 min y 'reauth' con 15 (se lee como texto).
 *
 * LIMITES HONESTOS: esquema minimo (patron 5 del CLAUDE.md). La carrera de dos pagos simultaneos
 * con UN codigo la evita `for update skip locked` y NO se probo aqui (requiere dos sesiones).
 *
 *   node scripts/test-step-up-gasto-sql.mjs
 *
 * PGDATABASE debe empezar con `step_up_gasto` (el script borra esquemas).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

assert.match(process.env.PGDATABASE ?? '', /^step_up_gasto/, 'PGDATABASE debe empezar con step_up_gasto (el script borra esquemas)');

const psql = (sql) => execFileSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const migracion = (archivo) => readFileSync(new URL(`../supabase/migrations/${archivo}`, import.meta.url), 'utf8');
const leerFuente = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');

psql(`
  drop schema if exists messaging_private cascade;
  drop schema if exists auth cascade;
  drop table if exists public.reauth_proofs, public.sensitive_verifications cascade;
  drop function if exists public.user_has_totp(uuid), public.reauth_satisfied(uuid), public.consume_spend_step_up(uuid);
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  end $$;
  create schema auth;
  create table auth.users (id uuid primary key);
  create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null, factor_type text not null, status text not null);
  create schema messaging_private;
  -- La tabla tal como la dejo 20260818204133 (sin purpose ni consumed_at: los agrega la migracion nueva).
  create table public.sensitive_verifications (id uuid primary key default gen_random_uuid(), user_id uuid, verified_at timestamptz default now(), method text not null, expires_at timestamptz not null);
  grant usage on schema auth, messaging_private to authenticated, anon, service_role;
`);
// Migracion anterior (reautenticacion unica) tal cual, y despues la nueva tal cual.
psql(migracion('20261013014305_reautenticacion_unica.sql'));

const usuario = ({ totp = true } = {}) => {
  const id = randomUUID();
  psql(`insert into auth.users(id) values ('${id}');
        ${totp ? `insert into auth.mfa_factors(user_id, factor_type, status) values ('${id}','totp','verified');` : ''}`);
  return id;
};
// `purpose` solo existe tras la migracion nueva; antes cada fila era implicitamente 'reauth'.
let nueva = false;
const dar = (id, { purpose = 'spend', method = 'totp', vence = "now() + interval '5 minutes'" } = {}) =>
  psql(`insert into public.sensitive_verifications(user_id, method, expires_at${nueva ? ', purpose' : ''}) values ('${id}','${method}',${vence}${nueva ? `,'${purpose}'` : ''})`);
const consumir = (id) => psql(`select public.consume_spend_step_up('${id}')`) === 't';
const reautenticado = (id) => psql(`select public.reauth_satisfied('${id}')`) === 't';

let n = 0;
const prueba = (nombre, fn) => { fn(); console.log(`ok ${++n} - ${nombre}`); };

// ---- 1. El defecto, con la logica VIEJA ("existe alguna fila vigente") ---------------------------------
const logicaVieja = (id) => psql(`select exists(select 1 from public.sensitive_verifications where user_id='${id}' and expires_at > now())`) === 't';
prueba('VIEJA: el codigo tecleado para CANCELAR (15 min) ya contaba como prueba para PAGAR (el defecto)', () => {
  const u = usuario();
  dar(u, { vence: "now() + interval '15 minutes'" });            // lo que dejaba la cancelacion
  assert.equal(logicaVieja(u), true, 'con la logica vieja, el pago pasaba sin pedir otro codigo');
});

// ---- 2. Se aplica la migracion nueva, tal cual -------------------------------------------------------------
psql(migracion('20261013031834_step_up_de_gasto_un_solo_uso.sql'));
nueva = true;

prueba('NUEVA: el codigo de una CANCELACION (reauth) ya NO sirve para pagar', () => {
  const u = usuario();
  dar(u, { purpose: 'reauth', vence: "now() + interval '15 minutes'" });
  assert.equal(consumir(u), false);
  assert.equal(reautenticado(u), true, 'pero SI sigue valiendo para reautenticar');
});
prueba('una prueba de gasto se CONSUME: sirve para un gasto y solo uno', () => {
  const u = usuario();
  dar(u);
  assert.equal(consumir(u), true);
  assert.equal(consumir(u), false, 'el segundo gasto con el mismo codigo no pasa');
  assert.equal(psql(`select count(*) from public.sensitive_verifications where user_id='${u}' and consumed_at is not null`), '1', 'queda marcada como consumida, no borrada (rastro)');
});
prueba('dos codigos = dos gastos; el tercero no', () => {
  const u = usuario();
  dar(u); dar(u);
  assert.equal(consumir(u), true);
  assert.equal(consumir(u), true);
  assert.equal(consumir(u), false);
});
prueba('una prueba de GASTO no sirve para reautenticar (cancelar, cambiar telefono)', () => {
  const u = usuario();
  dar(u, { purpose: 'spend' });
  assert.equal(reautenticado(u), false);
});
prueba('vencida, ajena o de otro `method`: no sirve', () => {
  const u = usuario(), otro = usuario();
  dar(u, { vence: "now() - interval '1 second'" });
  assert.equal(consumir(u), false, 'vencida');
  dar(otro);
  assert.equal(consumir(u), false, 'la prueba de OTRA cuenta no vale');
  dar(u, { method: 'password' });
  assert.equal(consumir(u), false, 'method distinto de totp');
});
prueba('usuario nulo o sin pruebas: false, sin error', () => {
  assert.equal(psql(`select public.consume_spend_step_up(null)`), 'f');
  assert.equal(consumir(usuario()), false);
});
prueba('el default de las filas existentes es reauth (lo que eran)', () => {
  assert.equal(psql(`select column_default from information_schema.columns where table_name='sensitive_verifications' and column_name='purpose'`), "'reauth'::text");
  assert.throws(() => psql(`insert into public.sensitive_verifications(user_id, method, expires_at, purpose) values ('${randomUUID()}','totp', now(), 'otra')`), /check/i);
});
prueba('solo el service_role ejecuta consume_spend_step_up', () => {
  const u = usuario();
  dar(u);
  for (const rol of ['authenticated', 'anon']) assert.throws(() => psql(`set role ${rol}; select public.consume_spend_step_up('${u}');`), /permission denied/i, rol);
  assert.equal(psql(`set role service_role; select public.consume_spend_step_up('${u}');`).split('\n').at(-1), 't');
});

// ---- 3. verify-sensitive-action emite el tipo y la vigencia correctos (texto) -------------------------------------
prueba('verify-sensitive-action: spend vence en 5 min, reauth en 15, y por defecto es reauth', () => {
  const f = leerFuente('supabase/functions/verify-sensitive-action/index.ts');
  assert.match(f, /const purpose = purposeIn === "spend" \? "spend" : "reauth";/, 'cualquier valor distinto de spend es reauth');
  assert.match(f, /\(purpose === "spend" \? 5 : 15\) \* 60 \* 1000/);
  assert.match(f, /method: "totp",\s*purpose,/, 'guarda el tipo en la fila');
});
// ---- 4. Los 5 creadores de pago + mensualidades + los 3 que ya gastaban --------------------------------------------
prueba('cada camino que gasta saldo/puntos exige el codigo ANTES de crear el cobro', () => {
  const caminos = {
    'create-checkout-session': /cashSolicitado > 0 \|\| puntosSolicitados > 0\) \{\s*const stepUpBlock = await enforceStepUp\(/,
    'create-paypal-order': /await exigirMfaSiGastaSaldo\(req, ppUser\?\.id, booking\)/,
    'create-conekta-order': /await exigirMfaSiGastaSaldo\(req, user\?\.id, booking\)/,
    'create-openpay-checkout': /await exigirMfaSiGastaSaldo\(req, user\?\.id, booking\)/,
    'create-mercadopago-preference': /await exigirMfaSiGastaSaldo\(req, authedUser\?\.id, booking\)/,
    'process-payment-plan-installment': /if \(isWalletPayment\) \{\s*const stepUpBlock = await enforceStepUp\(/,
    'confirm-booking-wallet-payment': /await enforceStepUp\(/,
    'process-supplement-payment': /await enforceStepUp\(/,
    'purchase-post-booking-extras': /await enforceStepUp\(/,
  };
  for (const [fn, patron] of Object.entries(caminos)) {
    const src = leerFuente(`supabase/functions/${fn}/index.ts`);
    assert.match(src, patron, `${fn} no exige el codigo de gasto`);
  }
});
prueba('el select de cada creador trae lo que la decision necesita (payment_status, puntos, Cash)', () => {
  for (const fn of ['create-paypal-order', 'create-conekta-order', 'create-openpay-checkout', 'create-mercadopago-preference']) {
    const src = leerFuente(`supabase/functions/${fn}/index.ts`);
    assert.match(src, /\.select\("[^"]*payment_status[^"]*points_used[^"]*toursred_cash_used[^"]*"\)/, `${fn}: el select no trae payment_status, points_used y toursred_cash_used`);
  }
});
prueba('las pantallas que cobran una reserva reintentan tras pedir el codigo', () => {
  const ruta = (r) => leerFuente(r);
  const step4 = ruta('src/pages/booking-flow/BookingFlowStep4.tsx');
  for (const fn of ['create-checkout-session', 'create-mercadopago-preference', 'create-paypal-order', 'create-conekta-order', 'create-openpay-checkout'])
    assert.match(step4, new RegExp('await fetchWithStepUp\\(\\s*`[^`]*' + fn + '`'), `Step4 ${fn}`);
  assert.equal([...step4.matchAll(/if \(await bloqueoDeMfa\(resp\)\)/g)].length, 5, 'si cierra el modal la reserva ya existe: no es un error de red');
  const info = ruta('src/pages/TravelersInfoPage.tsx');
  for (const fn of ['create-checkout-session', 'create-mercadopago-preference', 'create-paypal-order', 'create-conekta-order'])
    assert.match(info, new RegExp('await fetchWithStepUp\\(\\s*`[^`]*' + fn + '`'), `TravelersInfoPage ${fn}`);
  const tb = ruta('src/pages/traveler/TravelerBookings.tsx');
  for (const fn of ['create-checkout-session', 'create-mercadopago-preference', 'create-paypal-order', 'create-conekta-order', 'create-openpay-checkout'])
    assert.match(tb, new RegExp('await fetchWithStepUp\\(\\s*`[^`]*' + fn + '`'), `TravelerBookings ${fn}`);
  const cal = ruta('src/components/PaymentPlanCalendar.tsx');
  assert.equal([...cal.matchAll(/await fetchWithStepUp\(`[^`]*process-payment-plan-installment`/g)].length, 2, 'las dos mensualidades');
});
prueba('el modal manda el proposito: STEP_UP_REQUIRED = spend, REAUTH_REQUIRED = reauth', () => {
  const ui = leerFuente('src/context/StepUpContext.tsx');
  assert.match(ui, /proposito\.current = body\.code === 'REAUTH_REQUIRED' \? 'reauth' : 'spend';/);
  assert.match(ui, /JSON\.stringify\(\{ code, purpose: proposito\.current \}\)/);
});

console.log(`${n} pruebas del codigo de un solo uso OK.`);
