#!/usr/bin/env node
// Pantalla de regreso tras un abono («pagar con más de un método»), 19-oct-2026.
//
// Reportado probando Openpay en staging: se pagaron $350 de un exigible de $550, Openpay mandó su
// comprobante, el cobro quedó `succeeded` y la reserva en `processing`, pero la pantalla de regreso
// sondeaba ~50 s esperando `succeeded` y se quedaba en «Pago en proceso» para siempre.
//
//   1. La regla, EJECUTADA (src/lib/abonoRecibido.ts): cuánto se abonó, cuánto falta y cuándo la
//      reserva es «abono recibido» y no «pagada» ni «en proceso».
//   2. Contratos: PaymentReturnPage la usa en el sondeo de Openpay y Conekta, tras la captura de
//      PayPal y tras la aprobación de MercadoPago, y tiene la pantalla «Abono recibido» con el enlace a
//      Mis reservas; BookingSuccessPage (donde aterriza Stripe) ya no dice «reserva confirmada» con un
//      saldo por pagar.
//
// No prueba la pantalla en un navegador ni contra una pasarela real.
//
//   node scripts/test-abono-recibido.mjs   (Node 24; en 22 agrega --experimental-strip-types)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const m = await import('../src/lib/abonoRecibido.ts');

let casos = 0;
const prueba = async (nombre, fn) => {
  try { await fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; }
};
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !/^\s*\/\//.test(l))
  .map((l) => l.replace(/\s\/\/.*$/, ''))
  .join('\n');
const fuente = (f) => sinComentarios(readFileSync(f, 'utf8'));

const cobro = (amount, extra = {}) => ({ amount, status: 'succeeded', charge_context: 'booking_deposit', ...extra });
const reserva = (extra = {}) => ({ payment_status: 'processing', amount_due_now: 550, membership_cost: 0, deposit_amount: 500, total_price: 1000, ...extra });

await prueba('el caso reportado: $350 de $550 es abono recibido con $200 de saldo', () => {
  const e = m.estadoDeAbono(reserva(), [cobro(350)]);
  assert.deepEqual(e, { abonado: 350, saldo: 200, hayAbonoPendiente: true });
});

await prueba('con los dos cobros ($350 + $200) ya no es abono: está pagado', () => {
  const e = m.estadoDeAbono(reserva({ payment_status: 'succeeded' }), [cobro(350), cobro(200)]);
  assert.equal(e.saldo, 0);
  assert.equal(e.hayAbonoPendiente, false);
  // aunque la reserva siguiera en `processing` un instante, sin saldo no se anuncia un abono
  assert.equal(m.estadoDeAbono(reserva(), [cobro(350), cobro(200)]).hayAbonoPendiente, false);
});

await prueba('el abono se mide contra TODOS los procesadores y solo cuenta lo `succeeded` del anticipo', () => {
  const e = m.estadoDeAbono(reserva(), [
    cobro(100, { payment_processor: 'stripe' }),
    cobro(150, { payment_processor: 'paypal' }),
    cobro(999, { status: 'pending' }),
    cobro(999, { status: 'failed' }),
    cobro(999, { charge_context: 'insurance' }),
    cobro(999, { charge_context: 'supplement' }),
  ]);
  assert.equal(e.abonado, 250);
  assert.equal(e.saldo, 300);
});

await prueba('sin ningún cobro confirmado todavía no hay abono (el webhook aún no llega)', () => {
  assert.equal(m.estadoDeAbono(reserva(), []).hayAbonoPendiente, false);
  assert.equal(m.estadoDeAbono(reserva(), [cobro(350, { status: 'pending' })]).hayAbonoPendiente, false);
});

await prueba('solo una reserva en `processing` es abono; pagada, cancelada o pendiente no', () => {
  for (const ps of ['succeeded', 'cancelled', 'pending', null]) {
    assert.equal(m.estadoDeAbono(reserva({ payment_status: ps }), [cobro(350)]).hayAbonoPendiente, false, String(ps));
  }
});

await prueba('el exigible es el de exigible.ts: amount_due_now menos la membresía, o el anticipo si falta', () => {
  assert.equal(m.exigibleDeLaReserva({ amount_due_now: 550, membership_cost: 50 }), 500);
  assert.equal(m.exigibleDeLaReserva({ amount_due_now: null, deposit_amount: 500, total_price: 1000 }), 500);
  assert.equal(m.exigibleDeLaReserva({ amount_due_now: null, deposit_amount: null, total_price: 1000 }), 1000);
  assert.equal(m.exigibleDeLaReserva({ amount_due_now: 0, membership_cost: 0 }), 0);
  // con la membresía dentro de amount_due_now, no se le pide al viajero como saldo del procesador
  assert.equal(m.estadoDeAbono(reserva({ amount_due_now: 600, membership_cost: 50 }), [cobro(350)]).saldo, 200);
});

await prueba('un saldo dentro de la tolerancia ($0.50) cuenta como pagado', () => {
  assert.equal(m.estadoDeAbono(reserva({ amount_due_now: 350.3 }), [cobro(350)]).hayAbonoPendiente, false);
  assert.equal(m.estadoDeAbono(reserva({ amount_due_now: 351 }), [cobro(350)]).hayAbonoPendiente, true);
});

await prueba('leerEstadoDeAbono: lee reserva y cobros; si falla devuelve null y deja rastro', async () => {
  const tablas = { bookings: { data: reserva(), error: null }, payment_transactions: { data: [cobro(350)], error: null } };
  const cliente = (t) => ({ from: (nombre) => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => t[nombre], then: (r, j) => Promise.resolve(t[nombre]).then(r, j) };
    return q;
  } });
  assert.deepEqual(await m.leerEstadoDeAbono(cliente(tablas), 'b1'), { abonado: 350, saldo: 200, hayAbonoPendiente: true });
  const registros = [];
  const antes = console.error; console.error = (...a) => registros.push(a);
  try {
    assert.equal(await m.leerEstadoDeAbono(cliente({ ...tablas, payment_transactions: { data: null, error: { code: 'X' } } }), 'b1'), null);
    assert.equal(await m.leerEstadoDeAbono(cliente({ ...tablas, bookings: { data: null, error: null } }), 'b1'), null);
  } finally { console.error = antes; }
  assert.equal(registros.length, 2, 'cada lectura fallida deja rastro');
});

await prueba('PaymentReturnPage: Openpay y Conekta detectan el abono en el sondeo y en el último vistazo', () => {
  const f = fuente('src/pages/PaymentReturnPage.tsx');
  assert.match(f, /type ReturnStatus = [^;]*'partial'/);
  assert.equal((f.match(/payment_status === 'processing' && await mostrarAbonoSiCorresponde\(\)/g) ?? []).length, 2, 'una vez en Conekta y otra en Openpay');
  // el último vistazo va ANTES de rendirse con «Tu pago está siendo procesado»
  const ultimos = [...f.matchAll(/if \(await mostrarAbonoSiCorresponde\(\)\) return;\s*setStatus\('pending'\);\s*setMessage\('Tu pago está siendo procesado/g)];
  assert.equal(ultimos.length, 2, 'último vistazo antes del pendiente, en Conekta y en Openpay');
});

await prueba('PaymentReturnPage: PayPal y MercadoPago no dicen «reserva confirmada» si solo hubo un abono', () => {
  const f = fuente('src/pages/PaymentReturnPage.tsx');
  assert.match(f, /if \(!giftCardId && await mostrarAbonoSiCorresponde\(\)\) return;\s*setStatus\('success'\);/, 'PayPal');
  const mp = [...f.matchAll(/if \(await mostrarAbonoSiCorresponde\(\)\) return;\s*setMessage\('Pago exitoso\. Tu reserva ha sido confirmada\.'\)/g)];
  assert.equal(mp.length, 2, 'MercadoPago: por collection_status y por provider');
});

await prueba('PaymentReturnPage: la pantalla «Abono recibido» muestra abonado y saldo y lleva a Mis reservas', () => {
  const f = fuente('src/pages/PaymentReturnPage.tsx');
  const i = f.indexOf("status === 'partial' && abono");
  assert.ok(i > 0, 'hay un bloque para el estado partial');
  const bloque = f.slice(i, f.indexOf("status === 'cancel'", i));
  assert.match(bloque, /Abono recibido/);
  assert.match(bloque, /formatCurrencyMXN\(abono\.abonado\)/);
  assert.match(bloque, /formatCurrencyMXN\(abono\.saldo\)/);
  assert.match(bloque, /onClick=\{handleGoToBookings\}/);
  assert.match(f, /navigate\('\/traveler\/bookings'\)/);
});

await prueba('BookingSuccessPage: con abono pendiente no dice «reserva confirmada»', () => {
  const f = fuente('src/pages/BookingSuccessPage.tsx');
  assert.match(f, /leerEstadoDeAbono\(supabase, bookingId\)/);
  assert.match(f, /setAbono\(estadoAbono\?\.hayAbonoPendiente \? estadoAbono : null\)/);
  const i = f.indexOf('{abono ? (');
  assert.ok(i > 0);
  const abonoRama = f.slice(i, f.indexOf(') : (', i));
  assert.match(abonoRama, /Abono recibido/);
  assert.doesNotMatch(abonoRama, /Tu reserva ha sido confirmada/);
  assert.match(abonoRama, /to="\/traveler\/bookings"/);
  assert.match(f.slice(f.indexOf(') : (', i)), /Tu reserva ha sido confirmada/, 'el camino de siempre se conserva');
});

console.log(`OK: ${casos} casos de abono recibido.`);
