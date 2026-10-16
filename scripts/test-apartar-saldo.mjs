#!/usr/bin/env node
// Apartar el saldo al crear el cobro con pasarela (16-oct-2026).
//
// La base (apartar_saldo_de_reserva, el trigger que libera y el tope de
// refund_points_for_cancellation) la prueba test-apartar-saldo.sql. Aqui, leido
// del codigo sin comentarios:
//   1. Las cinco funciones que abren un cobro de reserva apartan el saldo DESPUES
//      del codigo MFA y ANTES de llamar a la pasarela.
//   2. Stripe aparta los montos que descuenta su sesion.
//   3. stripe-webhook ya no acredita Cash al expirar o fallar (lo creaba de la
//      nada) ni cancela una reserva ya pagada.
//
//   node scripts/test-apartar-saldo.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let casos = 0;
const prueba = (nombre, fn) => {
  try { fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; }
};

const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !/^\s*\/\//.test(l))
  .map((l) => l.replace(/\s\/\/.*$/, ''))
  .join('\n');
const fn = (n) => sinComentarios(readFileSync(`supabase/functions/${n}/index.ts`, 'utf8'));

prueba('_shared/gastoDeSaldo.ts: apartarSaldoDeReserva llama a apartar_saldo_de_reserva', () => {
  const c = sinComentarios(readFileSync('supabase/functions/_shared/gastoDeSaldo.ts', 'utf8'));
  assert.match(c, /export async function apartarSaldoDeReserva\(/);
  assert.match(c, /supabase\.rpc\("apartar_saldo_de_reserva"/);
  assert.match(c, /status: 400/, 'si no se pudo apartar, el cobro no se abre');
});

// [funcion, como valida el MFA del gasto, la llamada que abre el cobro]
const COBROS = [
  ['create-checkout-session', 'enforceStepUp(', 'stripe.checkout.sessions.create('],
  ['create-paypal-order', 'exigirMfaSiGastaSaldo(', '/v2/checkout/orders'],
  ['create-mercadopago-preference', 'exigirMfaSiGastaSaldo(', 'https://api.mercadopago.com/checkout/preferences'],
  ['create-conekta-order', 'exigirMfaSiGastaSaldo(', '${conektaApiBase}/orders'],
  ['create-openpay-checkout', 'exigirMfaSiGastaSaldo(', 'createSpeiCharge('],
];

for (const [nombre, mfa, pasarela] of COBROS) {
  const c = fn(nombre);
  prueba(`${nombre}: aparta el saldo despues del MFA y antes de abrir la pasarela`, () => {
    const iMfa = c.indexOf(mfa);
    const iApartar = c.indexOf('apartarSaldoDeReserva(supabase, ');
    const iPasarela = c.indexOf(pasarela);
    assert.ok(iMfa > 0, `no encontre ${mfa}`);
    assert.ok(iApartar > 0, 'no aparta el saldo');
    assert.ok(iPasarela > 0, `no encontre ${pasarela}`);
    assert.ok(iMfa < iApartar, 'aparta antes de verificar el codigo MFA del gasto');
    assert.ok(iApartar < iPasarela, 'abre la pasarela antes de apartar el saldo');
    assert.match(c, /if \(apartadoBlock\) return apartadoBlock;/);
  });
}

prueba('create-checkout-session: aparta los montos que descuenta la sesion', () => {
  assert.match(fn('create-checkout-session'),
    /apartarSaldoDeReserva\(supabase, bookingId, booking, \{\s*puntos: puntosSolicitados,\s*cash: cashSolicitado,\s*\}\)/);
});

prueba('stripe-webhook: expirar o fallar ya no acredita Cash ni llama a la devolucion rota', () => {
  const c = fn('stripe-webhook');
  const i = c.indexOf("case 'checkout.session.expired':");
  const j = c.indexOf("case 'payment_intent.payment_failed':");
  assert.ok(i > 0 && j > i);
  const bloque = c.slice(i, c.indexOf('break;', c.indexOf("console.log(`Successfully cancelled failed booking", j)));
  assert.doesNotMatch(bloque, /p_type: 'credit'/, 'acreditaba Cash que nunca se debito');
  assert.doesNotMatch(bloque, /refund_points_for_cancelled_booking/);
});

prueba('stripe-webhook: expirar o fallar no cancela una reserva ya pagada', () => {
  const c = fn('stripe-webhook');
  for (const v of ['expiredUpdate', 'failedUpdate']) {
    assert.match(c, new RegExp(`\\.update\\(${v}\\)\\s*\\.eq\\('id', bookingId\\)\\s*\\.neq\\('payment_status', 'succeeded'\\)`), v);
  }
});

console.log(`Apartar saldo al crear el cobro: ${casos} casos OK`);
