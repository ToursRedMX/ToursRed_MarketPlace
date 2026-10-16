#!/usr/bin/env node
// Puntos + Conekta / OpenPay en suplementos, extras y mensualidades (16-oct-2026).
//
// Misma base que puntos + tarjeta (puntos_apartados_cargos, ver
// test-puntos-apartados-cargos.sql). Aqui:
//   1. La regla, EJECUTADA: el apartado vence despues de que el procesador deja
//      de aceptar el pago (efectivo y SPEI se pagan dias despues).
//   2. Cada rama aparta ANTES de crear el cobro, cobra solo el resto y libera si
//      el procesador falla; los dos webhooks consumen en los tres cargos.
//   3. Los errores previos que se corrigieron en el camino no regresan.
//
//   node scripts/test-puntos-conekta-openpay.mjs   (Node 24; en 22 agrega --experimental-strip-types)
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
const rama = (c, metodo) => {
  const i = c.indexOf(`if (payment_method === "${metodo}") {`);
  assert.ok(i > 0, `no hay rama ${metodo}`);
  return c.slice(i, c.indexOf('\n    }\n', i));
};

// ---------------------------------------------------------------------------
// 1. La regla
// ---------------------------------------------------------------------------
prueba('Conekta y OpenPay aceptan puntos; MercadoPago y PayPal todavia no', () => {
  for (const metodo of ['conekta', 'openpay']) assert.equal(m.validarPuntos(metodo, 25000, 500).ok, true, metodo);
  for (const metodo of ['mercadopago', 'paypal']) assert.equal(m.validarFormaDePuntos(metodo, 100).ok, false, metodo);
});

prueba('el apartado vence despues de que Conekta cierra el checkout (71 h)', () => {
  assert.ok(m.MINUTOS_APARTADO_CONEKTA > m.HORAS_CHECKOUT_CONEKTA * 60);
  assert.ok(m.MINUTOS_APARTADO_OPENPAY >= m.MINUTOS_APARTADO_CONEKTA);
});

// ---------------------------------------------------------------------------
// 2. Las funciones
// ---------------------------------------------------------------------------
const FUNCIONES = ['process-supplement-payment', 'purchase-post-booking-extras', 'process-payment-plan-installment'];

for (const nombre of FUNCIONES) {
  const c = fn(nombre);
  prueba(`${nombre}: montoPasarela = total menos lo que pagan los puntos`, () => {
    assert.match(c, /const montoPasarela = parseFloat\(\(totalToPay - pesosEnPuntos\)\.toFixed\(2\)\);/);
  });

  const conekta = rama(c, 'conekta');
  prueba(`${nombre} / Conekta: aparta antes de crear la orden y cobra el resto`, () => {
    const iApartar = conekta.indexOf('await apartarPuntosDeCargo(');
    const iOrden = conekta.indexOf('${conektaApiBase}/orders');
    assert.ok(iApartar > 0 && iOrden > iApartar, 'crea la orden antes de apartar');
    assert.match(conekta, /puntosUsados, MINUTOS_APARTADO_CONEKTA\)/);
    assert.match(conekta, /Math\.round\(montoPasarela \* 100\)/);
    assert.doesNotMatch(conekta, /totalToPay/, 'la rama de Conekta cobra el total sin descontar los puntos');
    assert.match(conekta, /points_used: String\(puntosUsados\)/);
  });
  prueba(`${nombre} / Conekta: si la orden falla, libera`, () => {
    assert.match(conekta, /if \(!apiResponse\.ok\) \{\s*if \(apartadoId\) await supabase\.rpc\("liberar_puntos_de_cargo"/);
    assert.match(conekta, /if \(!orderId\) \{\s*if \(apartadoId\) await supabase\.rpc\("liberar_puntos_de_cargo"/);
  });

  const openpay = rama(c, 'openpay');
  prueba(`${nombre} / OpenPay: aparta antes del cargo y cobra el resto`, () => {
    assert.match(openpay, /puntosUsados, MINUTOS_APARTADO_OPENPAY\)/);
    assert.doesNotMatch(openpay, /totalToPay/, 'la rama de OpenPay cobra el total sin descontar los puntos');
  });
}

for (const nombre of ['purchase-post-booking-extras', 'process-payment-plan-installment']) {
  const openpay = rama(fn(nombre), 'openpay');
  prueba(`${nombre} / OpenPay: libera si el cargo falla y ajusta el vencimiento a su fecha limite`, () => {
    const iApartar = openpay.indexOf('await apartarPuntosDeCargo(');
    const iCargo = openpay.indexOf('chargeOp = await create');
    assert.ok(iApartar > 0 && iCargo > iApartar, 'crea el cargo antes de apartar');
    assert.match(openpay, /\} catch \(e\) \{\s*if \(apartadoId\) await supabase\.rpc\("liberar_puntos_de_cargo"/);
    assert.match(openpay, /ajustarVencimientoDeApartado\(supabase, apartadoId, chargeOp\.due_date\)/);
  });
}

prueba('process-supplement-payment / OpenPay: aparta antes de create-openpay-checkout y libera si falla', () => {
  const openpay = rama(fn('process-supplement-payment'), 'openpay');
  const iApartar = openpay.indexOf('await apartarPuntosDeCargo(');
  const iCheckout = openpay.indexOf('functions/v1/create-openpay-checkout');
  assert.ok(iApartar > 0 && iCheckout > iApartar);
  assert.match(openpay, /if \(!opResult\.success\) \{\s*if \(apartadoId\) await supabase\.rpc\("liberar_puntos_de_cargo"/);
});

prueba('create-openpay-checkout: el cargo del suplemento resta los puntos apartados', () => {
  const c = fn('create-openpay-checkout');
  assert.match(c, /\.from\("puntos_apartados_cargos"\)\s*\.select\("puntos"\)\s*\.eq\("contexto", "supplement"\)\s*\.eq\("referencia", supplementId\)\s*\.eq\("estado", "apartado"\)/);
  assert.match(c, /amount = Math\.round\(\(amount - Number\(apartadoSupp\?\.puntos \?\? 0\) \/ 100\) \* 100\) \/ 100;/);
});

for (const [nombre, abono] of [['conekta-webhook', 'p_points_used: Number(puntosAbono || 0)'], ['openpay-webhook', 'p_points_used: Number(puntosAbonoOp || 0)']]) {
  const c = fn(nombre);
  prueba(`${nombre}: consume los puntos en los tres cargos`, () => {
    for (const ctx of ['supplement', 'insurance', 'optional_service']) {
      assert.match(c, new RegExp(`rpc\\("consumir_puntos_de_cargo", \\{ p_contexto: "${ctx}", p_referencia: chargeReferenceId \\}\\)`), ctx);
    }
    assert.match(c, /rpc\("consumir_puntos_de_cargo", \{ p_contexto: "payment_plan_installment", p_referencia: planId \}\)/);
    assert.ok(c.includes(abono), 'el abono no guarda sus puntos');
  });
}

// ---------------------------------------------------------------------------
// 3. Errores previos corregidos en el camino
// ---------------------------------------------------------------------------
prueba('conekta-webhook: el suplemento se marca pagado con payment_method (payment_provider no existe)', () => {
  const c = fn('conekta-webhook');
  const i = c.indexOf('chargeContext === "supplement" && chargeReferenceId');
  const bloque = c.slice(i, c.indexOf('chargeContext === "insurance"', i));
  assert.doesNotMatch(bloque, /payment_provider:/, 'el UPDATE con payment_provider falla entero');
  assert.match(bloque, /payment_method: "conekta"/);
});

prueba('openpay-webhook: el suplemento guarda payment_method', () => {
  assert.match(fn('openpay-webhook'), /status: "paid", paid_at: new Date\(\)\.toISOString\(\), payment_method: "openpay"/);
});

prueba('openpay-webhook: un abono en efectivo/SPEI suma los puntos al monto cobrado', () => {
  assert.match(fn('openpay-webhook'), /: chargeAmount \+ pesosPuntosAbonoOp;/);
});

console.log(`Puntos + Conekta/OpenPay: ${casos} casos OK`);
