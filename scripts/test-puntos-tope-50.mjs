#!/usr/bin/env node
// Tope del 50% de puntos en suplementos, extras y mensualidades (regla de Axel,
// 16-oct-2026), y lo que vino con el: cobro de puntos + Cash en una sola
// transaccion, reembolso de puntos como puntos, CFDI con los puntos como
// descuento y la casilla en las pantallas.
//
// La base (columnas, funciones SQL, polizas) la prueba
// test-puntos-tope-50-y-pago-mixto.sql contra la migracion real. Aqui:
//
//   1. La regla, EJECUTADA: se importan _shared/puntosConTope.ts (servidor) y
//      src/lib/puntosConTope.ts (navegador) y se comprueba que dan lo mismo.
//   2. El contrato de cada Edge Function y pantalla, leido del codigo SIN
//      comentarios (una mutacion en un comentario no debe pasar por buena).
//
//   node scripts/test-puntos-tope-50.mjs        (Node 24; en 22 agrega --experimental-strip-types)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const servidor = await import('../supabase/functions/_shared/puntosConTope.ts');
const navegador = await import('../src/lib/puntosConTope.ts');

let casos = 0;
const prueba = (nombre, fn) => {
  try { fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; }
};

// ---------------------------------------------------------------------------
// 1. La regla
// ---------------------------------------------------------------------------
prueba('maxPuntosPermitidos: 50% en puntos (100 pts = $1)', () => {
  assert.equal(servidor.maxPuntosPermitidos(500), 25000);
  assert.equal(servidor.maxPuntosPermitidos(1000), 50000);
  // 250.10 * 100 = 25009.999...: sin redondear a centavos daria 12504.
  assert.equal(servidor.maxPuntosPermitidos(250.10), 12505);
  assert.equal(servidor.maxPuntosPermitidos(0), 0);
  assert.equal(servidor.maxPuntosPermitidos(-5), 0);
  assert.equal(servidor.maxPuntosPermitidos(Number.NaN), 0);
});

prueba('servidor y navegador calculan el mismo tope', () => {
  for (let base = 0; base < 3000; base += 0.37) {
    const b = Math.round(base * 100) / 100;
    assert.equal(navegador.maxPuntosPermitidos(b), servidor.maxPuntosPermitidos(b), `base ${b}`);
  }
});

prueba('"points" sola ya no es forma de pago', () => {
  const r = servidor.validarFormaDePuntos('points', undefined);
  assert.equal(r.ok, false);
  assert.match(r.error, /50%/);
});

prueba('los puntos se combinan con ToursRed Cash o tarjeta; las demas pasarelas, en el siguiente PR', () => {
  for (const metodo of ['paypal', 'mercadopago', 'conekta', 'openpay']) {
    assert.equal(servidor.validarFormaDePuntos(metodo, 100).ok, false, metodo);
    assert.deepEqual(servidor.validarFormaDePuntos(metodo, undefined), { ok: true, puntos: 0, pesos: 0 }, `${metodo} sin puntos`);
  }
  assert.deepEqual(servidor.validarFormaDePuntos('toursred_cash', 2500), { ok: true, puntos: 2500, pesos: 25 });
  assert.deepEqual(servidor.validarFormaDePuntos('stripe', 2500), { ok: true, puntos: 2500, pesos: 25 });
});

prueba('points_to_use invalido se rechaza', () => {
  for (const malo of [-1, 1.5, 'abc', Number.NaN]) {
    assert.equal(servidor.validarFormaDePuntos('toursred_cash', malo).ok, false, String(malo));
  }
});

prueba('el tope se aplica sobre la base del pago', () => {
  assert.deepEqual(servidor.validarPuntos('toursred_cash', 25000, 500), { ok: true, puntos: 25000, pesos: 250 });
  const pasado = servidor.validarPuntos('toursred_cash', 25001, 500);
  assert.equal(pasado.ok, false);
  assert.match(pasado.error, /25,000/);
  // Sin puntos no hay tope que revisar.
  assert.deepEqual(servidor.validarPuntos('toursred_cash', 0, 500), { ok: true, puntos: 0, pesos: 0 });
});

prueba('puntos ganados sin pasarela: Cash doble, puntos sencillos', () => {
  // Los mismos casos que award_points_for_booking y la prueba SQL.
  assert.equal(servidor.puntosGanadosSinPasarela(500, 250), 750);
  assert.equal(servidor.puntosGanadosSinPasarela(1000, 500), 1500);
  assert.equal(servidor.puntosGanadosSinPasarela(1000, 0), 2000);
});

prueba('puntosAAplicar (navegador): todos los que alcancen, hasta el tope', () => {
  assert.equal(navegador.puntosAAplicar(true, 99999, 500), 25000);
  assert.equal(navegador.puntosAAplicar(true, 100, 500), 100);
  assert.equal(navegador.puntosAAplicar(false, 99999, 500), 0);
  assert.equal(navegador.puntosAAplicar(true, 99999, 0), 0);
});

// ---------------------------------------------------------------------------
// 2. El contrato en el codigo
// ---------------------------------------------------------------------------
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !/^\s*\/\//.test(l))
  .map((l) => l.replace(/\s\/\/.*$/, ''))
  .join('\n');
const fuente = (f) => sinComentarios(readFileSync(f, 'utf8'));
const fn = (nombre) => fuente(`supabase/functions/${nombre}/index.ts`);
const cuenta = (s, re) => (s.match(re) || []).length;

const COBROS = {
  'process-supplement-payment': ['create_accounting_entry_for_supplement'],
  'purchase-post-booking-extras': ['create_accounting_entry_for_optional_service', 'create_accounting_entry_for_insurance_purchase'],
  'process-payment-plan-installment': ['create_accounting_entry_for_payment_plan_installment'],
};

for (const [nombre, asientos] of Object.entries(COBROS)) {
  const c = fn(nombre);
  prueba(`${nombre}: "points" sola se rechaza ANTES del codigo MFA`, () => {
    const forma = c.indexOf('validarFormaDePuntos(payment_method, points_to_use)');
    const mfa = c.indexOf('enforceStepUp(');
    assert.ok(forma > 0, 'no llama a validarFormaDePuntos');
    assert.ok(mfa > 0, 'no llama a enforceStepUp');
    assert.ok(forma < mfa, 'valida los puntos despues del codigo MFA: le gasta un codigo al viajero');
  });
  prueba(`${nombre}: aplica el tope del 50%`, () => {
    assert.match(c, /validarPuntos\(payment_method, points_to_use, /);
  });
  prueba(`${nombre}: ya no tiene camino de pago 100% con puntos`, () => {
    assert.doesNotMatch(c, /rpc\("deduct_points"/);
    assert.doesNotMatch(c, /if \(payment_method === "points"\)/);
  });
  prueba(`${nombre}: cobra puntos y Cash en una sola transaccion`, () => {
    assert.match(c, /rpc\("cobrar_saldo_y_puntos"/);
    assert.doesNotMatch(c, /rpc\("update_wallet_balance"/);
  });
  prueba(`${nombre}: el cobro con saldo crea su poliza`, () => {
    for (const a of asientos) assert.match(c, new RegExp(`rpc\\("${a}"`), a);
  });
}

prueba('process-payment-plan-installment: referencia unica por abono y points_used al asignar', () => {
  const c = fn('process-payment-plan-installment');
  assert.match(c, /p_points_used: puntosUsados/);
  // Con plan_id, deduct_points ignoraria el canje del segundo abono (mismo reference_id).
  assert.match(c, /rpc\("cobrar_saldo_y_puntos", \{[\s\S]{0,200}p_reference_id: installmentTxId/);
  assert.match(c, /validarPuntos\(payment_method, points_to_use, effectiveAmount\)/, 'el tope va sobre cada abono');
});

prueba('purchase-post-booking-extras: el seguro guarda lo pagado con saldo', () => {
  const c = fn('purchase-post-booking-extras');
  assert.match(c, /travel_insurance_points_used = puntosUsados/);
  assert.match(c, /travel_insurance_cash_used = /);
  assert.match(c, /points_used: puntosUsados \}\)/, 'la fila del servicio opcional guarda points_used');
});

for (const nombre of ['cancel-individual-supplement', 'cancel-optional-service']) {
  const c = fn(nombre);
  prueba(`${nombre}: lo pagado con puntos regresa como puntos`, () => {
    assert.match(c, /rpc\("reembolsar_saldo_y_puntos"/);
    assert.match(c, /p_points_return: puntosADevolver/);
    assert.match(c, /p_cash: cashADevolver/);
    assert.doesNotMatch(c, /rpc\("update_wallet_balance"/, 'devolver con update_wallet_balance regresa todo en Cash');
  });
  prueba(`${nombre}: ya no llama a deduct_points_for_booking con un parametro que no existe`, () => {
    assert.doesNotMatch(c, /deduct_points_for_booking/);
    assert.match(c, /p_points_clawback: puntosGanadosAQuitar/);
  });
  prueba(`${nombre}: la nota de credito ampara solo lo devuelto en dinero`, () => {
    assert.doesNotMatch(c, /refund_amount: refundAmount,\s*item_description/);
    assert.ok(cuenta(c, /refund_amount: cashADevolver/g) >= 1);
  });
}

for (const nombre of ['generate-supplement-cfdi', 'generate-optional-service-cfdi', 'generate-post-booking-insurance-cfdi', 'generate-booking-installment-cfdi']) {
  const c = fn(nombre);
  prueba(`${nombre}: los puntos salen como descuento`, () => {
    assert.match(c, /repartirDescuentoBruto\(conceptos, puntosMxn\)/);
  });
  prueba(`${nombre}: pagado con ToursRed Cash es forma 05`, () => {
    assert.match(c, /=== "toursred_cash" \? "05"/);
  });
}

prueba('TravelerBookings: sin opcion "points" y con la casilla en los tres modales', () => {
  const tb = fuente('src/pages/traveler/TravelerBookings.tsx');
  assert.doesNotMatch(tb, /id: 'points'/);
  assert.equal(cuenta(tb, /<UsarPuntosConCash/g), 3);
  assert.equal(cuenta(tb, /points_to_use: puntosAAplicar\(/g), 3);
});

prueba('PaymentPlanCalendar: casilla y points_to_use en abono y saldo total', () => {
  const cal = fuente('src/components/PaymentPlanCalendar.tsx');
  assert.equal(cuenta(cal, /<UsarPuntosConCash/g), 2);
  assert.equal(cuenta(cal, /points_to_use: puntosAAplicar\(/g), 2);
});

console.log(`Tope de puntos y pago mixto con Cash: ${casos} casos OK`);
