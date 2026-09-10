/**
 * Prueba de `_shared/exigible.ts` — la regla del exigible y del piso.
 *
 * Los casos NO son inventados: son las reservas reales del proyecto medidas el
 * 10-sep-2026, las mismas que destaparon el bug de `9dd296b`.
 *
 * Las dos que importan:
 *
 *   c5614bdc  pago 100% con ToursRed Cash. Debe 0, y `deposit_amount` es 500.
 *             Con `Math.max(deposit, amount_due_now - membership)` el techo de
 *             cobro subia a 500: se le podia cobrar 500 a quien no debe nada.
 *
 *   31db95c4  (TRG-E5BGCYW29XY) pago 4,706.84 con tarjeta y 562.61 en puntos
 *             sobre un anticipo de 5,149.50. La misma expresion, usada como
 *             PISO al confirmar, la dejaba en `processing` para siempre: 4,706.84
 *             nunca alcanza 5,149.50 si no se cuenta la billetera.
 *
 *   node scripts/test-exigible.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const fuente = readFileSync('supabase/functions/_shared/exigible.ts', 'utf8');
const compilado = ts.transpileModule(fuente.replace(/^import[^\n]*\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const contexto = vm.createContext({ exports: {}, console: { log() {}, warn() {}, error() {} } });
vm.runInContext(compilado, contexto);
const { exigibleAlProcesador, cubreElAnticipo, billeteraDeLaReserva } = contexto.exports;

/** La expresion que metio `9dd296b`, para comprobar que de verdad diferimos. */
const reglaVieja = (r) => Math.max(
  Number(r.deposit_amount || 0),
  Number(r.amount_due_now || 0) - Number(r.membership_cost || 0),
);

let ok = 0;
const casos = [];

// ── COBRAR: el techo es lo que se debe, no el bruto ─────────────────────
casos.push(() => {
  // c5614bdc — 100% ToursRed Cash
  const r = { deposit_amount: 500, amount_due_now: 0, membership_cost: 0, toursred_cash_used: 500 };
  assert.equal(exigibleAlProcesador(r), 0,
    'quien pago todo con Cash no debe nada: el techo tiene que ser 0');
  assert.equal(reglaVieja(r), 500,
    'la prueba no reproduce el bug: la regla vieja ya daba 0');
});

casos.push(() => {
  // 31db95c4 — TRG-E5BGCYW29XY, tarjeta + puntos
  const r = { deposit_amount: 5149.50, amount_due_now: 4706.84, membership_cost: 0, points_used: 56261 };
  assert.equal(exigibleAlProcesador(r), 4706.84, 'el techo es lo que debe, no el anticipo bruto');
  assert.equal(reglaVieja(r), 5149.50);
});

casos.push(() => {
  // La membresia se cobra por otra via: no puede entrar en el techo del cobro.
  const r = { deposit_amount: 475, amount_due_now: 564, membership_cost: 89 };
  assert.equal(exigibleAlProcesador(r), 475, 'hay que descontar la membresia');
});

casos.push(() => {
  // amount_due_now null (reservas viejas): se cae al anticipo.
  assert.equal(exigibleAlProcesador({ deposit_amount: 2997.01, amount_due_now: null }), 2997.01);
  // Y si tampoco hay anticipo, a total_price.
  assert.equal(exigibleAlProcesador({ deposit_amount: null, amount_due_now: null, total_price: 1200 }), 1200);
});

casos.push(() => {
  // Nunca negativo, aunque la membresia supere lo exigible.
  assert.equal(exigibleAlProcesador({ deposit_amount: 0, amount_due_now: 50, membership_cost: 89 }), 0);
});

// ── CONFIRMAR: el piso es el bruto, con la billetera sumada ─────────────
casos.push(() => {
  // TRG-E5BGCYW29XY: PayPal cobra 4,706.84 y los puntos ponen 562.61.
  const r = { deposit_amount: 5149.50, amount_due_now: 4706.84, points_used: 56261, toursred_cash_used: 0 };
  const c = cubreElAnticipo(r, 4706.84);
  assert.equal(c.billetera, 562.61);
  assert.equal(c.cubierto, 5269.45);
  assert.equal(c.suficiente, true,
    'con la billetera contada, la reserva se confirma; sin ella se quedaba en processing');
  // Y sin contar la billetera —el bug— no llegaria:
  assert.ok(4706.84 < reglaVieja(r) - 0.5, 'la prueba no reproduce el bug');
});

casos.push(() => {
  // 100% ToursRed Cash: el procesador cobra 0 y aun asi se confirma.
  const c = cubreElAnticipo({ deposit_amount: 500, toursred_cash_used: 500 }, 0);
  assert.equal(c.suficiente, true);
  assert.equal(c.faltante, 0);
});

casos.push(() => {
  // Un cobro corto sigue sin confirmar: el guard no se aflojo.
  const c = cubreElAnticipo({ deposit_amount: 30000 }, 1);
  assert.equal(c.suficiente, false);
  assert.equal(c.faltante, 29999);
});

casos.push(() => {
  // Centavos: 0.40 por debajo entra dentro de la tolerancia de 0.5.
  assert.equal(cubreElAnticipo({ deposit_amount: 500 }, 499.60).suficiente, true);
  assert.equal(cubreElAnticipo({ deposit_amount: 500 }, 499.40).suficiente, false);
});

casos.push(() => {
  // Reserva vacia (lectura fallida): el piso da 0 y "suficiente" seria true.
  // Por eso los llamadores tienen que rechazar ANTES de llegar aqui; esta
  // prueba deja escrito que el helper no puede protegerlos de eso.
  assert.equal(cubreElAnticipo({}, 0).suficiente, true,
    'si esto cambia, revisa los guards de capture-paypal-order y conekta-webhook');
});

casos.push(() => {
  assert.equal(billeteraDeLaReserva({ points_used: 9103, toursred_cash_used: 1781.51 }), 1872.54);
  assert.equal(billeteraDeLaReserva({}), 0);
});

for (const caso of casos) { caso(); ok++; }
console.log(`Exigible y piso: ${ok}/${casos.length} casos OK`);
