#!/usr/bin/env node
// Puntos + tarjeta (Stripe) en suplementos, extras y mensualidades (16-oct-2026).
//
// La base (puntos_apartados_cargos y sus funciones) la prueba
// test-puntos-apartados-cargos.sql. Aqui:
//   1. La regla, EJECUTADA: Stripe acepta puntos y el cobro expira antes que el
//      apartado.
//   2. Cada funcion aparta los puntos ANTES de abrir Stripe, cobra el resto, y
//      libera si Stripe falla; stripe-webhook los consume al confirmar.
//   3. Las pantallas ofrecen la casilla tambien con tarjeta.
//
//   node scripts/test-puntos-con-tarjeta.mjs   (Node 24; en 22 agrega --experimental-strip-types)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const m = await import('../supabase/functions/_shared/puntosConTope.ts');

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
const fuente = (f) => sinComentarios(readFileSync(f, 'utf8'));

// ---------------------------------------------------------------------------
// 1. La regla
// ---------------------------------------------------------------------------
prueba('Stripe acepta puntos; las otras pasarelas todavia no', () => {
  assert.equal(m.validarPuntos('stripe', 25000, 500).ok, true);
  assert.equal(m.validarPuntos('stripe', 25001, 500).ok, false, 'el tope del 50% aplica igual');
  for (const metodo of ['paypal', 'mercadopago', 'conekta', 'openpay']) {
    assert.equal(m.validarFormaDePuntos(metodo, 100).ok, false, metodo);
  }
});

prueba('el cobro con puntos expira ANTES que el apartado (ningun pago llega ya liberado)', () => {
  assert.ok(m.MINUTOS_COBRO_CON_PUNTOS < m.MINUTOS_APARTADO);
  assert.ok(m.MINUTOS_COBRO_CON_PUNTOS >= 30 && m.MINUTOS_COBRO_CON_PUNTOS <= 24 * 60, 'Stripe acepta de 30 min a 24 h');
  const ahora = Math.floor(Date.now() / 1000);
  const expira = m.expiracionDelCobroConPuntos();
  assert.ok(Math.abs(expira - (ahora + m.MINUTOS_COBRO_CON_PUNTOS * 60)) <= 2);
});

// ---------------------------------------------------------------------------
// 2. Las funciones
// ---------------------------------------------------------------------------
const COBROS = [
  ['process-supplement-payment', '"supplement"', /unit_amount: Math\.round\(montoTarjeta \* 100\)/],
  ['purchase-post-booking-extras', 'type === "insurance" ? "insurance" : "optional_service"', /unit_amount: Math\.round\(montoTarjeta \* 100\)/],
  ['process-payment-plan-installment', '"payment_plan_installment"', /unit_amount: Math\.round\(\(effectiveAmount - pesosEnPuntos\) \* 100\)/],
];
for (const [nombre, contexto, cobroReducido] of COBROS) {
  const c = fn(nombre);
  const stripe = c.slice(c.indexOf('if (payment_method === "stripe") {'));
  prueba(`${nombre}: aparta los puntos antes de abrir Stripe`, () => {
    const iApartar = stripe.indexOf('await apartarPuntosDeCargo(');
    const iStripe = stripe.indexOf('stripe.checkout.sessions.create(');
    assert.ok(iApartar > 0 && iStripe > 0 && iApartar < iStripe, 'abre Stripe antes de apartar');
    assert.ok(stripe.slice(iApartar, iApartar + 200).includes(contexto), `contexto ${contexto}`);
  });
  prueba(`${nombre}: Stripe cobra solo el resto`, () => {
    assert.match(stripe, cobroReducido);
  });
  prueba(`${nombre}: con puntos el cobro expira, y si Stripe falla se liberan`, () => {
    assert.match(stripe, /\.\.\.\(apartadoId \? \{ expires_at: expiracionDelCobroConPuntos\(\) \} : \{\}\)/);
    assert.match(stripe, /catch \(stripeErr\) \{\s*if \(apartadoId\) await supabase\.rpc\("liberar_puntos_de_cargo", \{ p_apartado_id: apartadoId \}\);/);
    assert.match(stripe, /points_used: String\(puntosUsados\)/);
  });
  prueba(`${nombre}: los puntos con tarjeta piden el codigo MFA de gasto`, () => {
    assert.match(c, /formaPuntos\.puntos > 0\) \{\s*const stepUpBlock = await enforceStepUp\(/);
  });
}

prueba('stripe-webhook: consume los puntos en los tres cargos', () => {
  const c = fn('stripe-webhook');
  assert.match(c, /rpc\('consumir_puntos_de_cargo', \{ p_contexto: 'supplement', p_referencia: bookingSupplementId \}\)/);
  assert.match(c, /rpc\('consumir_puntos_de_cargo', \{\s*p_contexto: extraType === 'insurance' \? 'insurance' : 'optional_service',/);
  assert.match(c, /rpc\('consumir_puntos_de_cargo', \{ p_contexto: 'payment_plan_installment', p_referencia: planId \}\)/);
});

prueba('stripe-webhook: el cobro registrado es solo lo de la tarjeta', () => {
  const c = fn('stripe-webhook');
  assert.match(c, /amount: parseFloat\(\(totalToPay - pesosSupp\)\.toFixed\(2\)\)/);
  assert.match(c, /const planTotalToPay = parseFloat\(\(effectiveAmount \+ effectiveNetServiceCharge - puntosDelAbono \/ 100\)\.toFixed\(2\)\)/);
  assert.match(c, /points_used: puntosDelAbono,/, 'el abono guarda sus puntos');
});

prueba('stripe-webhook: el CFDI del extra recibe el valor completo y los puntos (no los resta dos veces)', () => {
  const c = fn('stripe-webhook');
  assert.match(c, /const totalDelExtra = parseFloat\(\(\(\(session\.amount_total \?\? 0\) \/ 100\) \+ puntosDelExtra \/ 100\)\.toFixed\(2\)\)/);
  assert.equal((c.match(/total_paid: totalDelExtra, payment_method: 'stripe', points_used: puntosDelExtra/g) || []).length, 2);
});

// ---------------------------------------------------------------------------
// 3. Pantallas
// ---------------------------------------------------------------------------
prueba('TravelerBookings: la casilla y points_to_use tambien con tarjeta', () => {
  const tb = fuente('src/pages/traveler/TravelerBookings.tsx');
  assert.equal((tb.match(/\.selectedMethod === 'toursred_cash' \|\| \w+\.selectedMethod === 'stripe'\) && \(\s*<UsarPuntosConCash/g) || []).length, 3);
  assert.equal((tb.match(/\(selectedMethod === 'toursred_cash' \|\| selectedMethod === 'stripe'\)\s*\? \{ points_to_use: puntosAAplicar\(/g) || []).length, 3);
});

prueba('PaymentPlanCalendar: la casilla y points_to_use tambien con tarjeta', () => {
  const cal = fuente('src/components/PaymentPlanCalendar.tsx');
  assert.equal((cal.match(/\(paymentProvider === 'toursred_cash' \|\| paymentProvider === 'stripe'\) && \(\s*<UsarPuntosConCash/g) || []).length, 2);
  assert.equal((cal.match(/\(\(paymentProvider === 'toursred_cash' \|\| paymentProvider === 'stripe'\)\s*\? \{ points_to_use: puntosAAplicar\(/g) || []).length, 2);
});

console.log(`Puntos + tarjeta: ${casos} casos OK`);
