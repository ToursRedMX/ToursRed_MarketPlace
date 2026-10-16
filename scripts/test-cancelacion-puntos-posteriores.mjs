#!/usr/bin/env node
// Cancelar la reserva completa devolvia en Cash lo pagado con puntos despues de
// reservar (extras, seguro, abonos y, en la cancelacion del tour, suplementos).
//
// La base la prueba test-cancelacion-puntos-posteriores.sql. Aqui:
//   1. _shared/puntosDeCargos.ts, EJECUTADO.
//   2. Cada llamador de process_cancellation_refund que suma cargos posteriores
//      informa sus puntos con la MISMA regla que su monto, leido del codigo sin
//      comentarios.
//
//   node scripts/test-cancelacion-puntos-posteriores.mjs   (Node 24; en 22 agrega --experimental-strip-types)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const m = await import('../supabase/functions/_shared/puntosDeCargos.ts');

let casos = 0;
const prueba = (nombre, fn) => {
  try { fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; }
};

// ---------------------------------------------------------------------------
// 1. El modulo
// ---------------------------------------------------------------------------
prueba('puntosDelCargo: los points_used del cargo', () => {
  assert.equal(m.puntosDelCargo({ points_used: 20000, metodo: 'toursred_cash', total: 400 }), 20000);
  assert.equal(m.puntosDelCargo({ points_used: '1500', metodo: 'toursred_cash', total: 30 }), 1500);
  assert.equal(m.puntosDelCargo({ points_used: 0, metodo: 'stripe', total: 400 }), 0);
  assert.equal(m.puntosDelCargo({ points_used: null, metodo: null, total: 400 }), 0);
});

prueba('puntosDelCargo: un cargo viejo pagado 100% con puntos cuenta entero', () => {
  assert.equal(m.puntosDelCargo({ points_used: 0, metodo: 'points', total: 250.5 }), 25050);
  assert.equal(m.puntosDelCargo({ points_used: null, metodo: 'points', total: '300' }), 30000);
});

prueba('puntosAlPorcentaje: piso, y el porcentaje acotado a 0..1', () => {
  assert.equal(m.puntosAlPorcentaje(10000, 0.5), 5000);
  assert.equal(m.puntosAlPorcentaje(10001, 0.5), 5000);
  assert.equal(m.puntosAlPorcentaje(10000, 1.7), 10000);
  assert.equal(m.puntosAlPorcentaje(10000, -1), 0);
  assert.equal(m.puntosAlPorcentaje(10000, Number.NaN), 0);
});

// ---------------------------------------------------------------------------
// 2. Los llamadores
// ---------------------------------------------------------------------------
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !/^\s*\/\//.test(l))
  .map((l) => l.replace(/\s\/\/.*$/, ''))
  .join('\n');
const fn = (n) => sinComentarios(readFileSync(`supabase/functions/${n}/index.ts`, 'utf8'));

const LLAMADORES = {
  'process-traveler-cancellation': 'puntosCargosPosteriores',
  'process-agency-booking-cancellation': 'puntosCargosPosteriores',
  'process-tour-cancellation': 'puntosCargosPosteriores',
  'admin-cancel-booking': 'puntosADevolver',
  'process-payment-plan-tour-deadline': 'puntosDeAbonos',
};

for (const [nombre, variable] of Object.entries(LLAMADORES)) {
  const c = fn(nombre);
  prueba(`${nombre}: informa los puntos de los cargos posteriores a process_cancellation_refund`, () => {
    const llamadas = c.match(/rpc\(\s*"process_cancellation_refund",\s*\{[\s\S]*?\}\s*\)/g) || [];
    assert.ok(llamadas.length > 0, 'no llama a process_cancellation_refund');
    for (const l of llamadas) {
      assert.match(l, new RegExp(`p_puntos_cargos_posteriores: ${variable}`), 'una llamada no informa los puntos');
    }
  });
  prueba(`${nombre}: los abonos leen points_used`, () => {
    assert.match(c, /\.from\("booking_payment_plan_transactions"\)\s*\.select\("service_charge, points_used, amount, payment_provider"\)/);
    assert.match(c, /puntosDelCargo\(\{ points_used: tx\.points_used, metodo: tx\.payment_provider, total: tx\.amount \}\)/);
  });
}

for (const nombre of ['process-traveler-cancellation', 'process-agency-booking-cancellation', 'process-tour-cancellation', 'admin-cancel-booking']) {
  const c = fn(nombre);
  prueba(`${nombre}: los extras y el seguro leen sus puntos`, () => {
    assert.match(c, /puntosDelCargo\(\{ points_used: (bos|os)\.points_used, metodo: (bos|os)\.payment_method/);
    assert.match(c, /travel_insurance_points_used/);
  });
}

prueba('process-traveler-cancellation: abonos y seguro al % de la politica, extras solo si se reembolsan', () => {
  const c = fn('process-traveler-cancellation');
  assert.match(c, /puntosAlPorcentaje\(puntosDeAbonos, refundPct\)/);
  assert.match(c, /puntosAlPorcentaje\(Number\(\(booking as unknown as \{ travel_insurance_points_used\?: number \| null \}\)\.travel_insurance_points_used\) \|\| 0, refundPct\)/);
  // Los puntos del extra se suman dentro del mismo if que su subtotal.
  assert.match(c, /if \(isRefundable\) \{\s*optionalServicesRefundable \+= [^\n]+\n\s*puntosDeOpcionales \+= puntosDelCargo/);
});

prueba('admin-cancel-booking: puntos en proporcion a lo que devuelve el admin, suplementos incluidos', () => {
  const c = fn('admin-cancel-booking');
  assert.match(c, /Math\.min\(1, Math\.max\(0, Number\(refund_amount\) \|\| 0\) \/ suggestedRefund\)/);
  assert.match(c, /puntosDelCargo\(\{ points_used: supp\.points_used, metodo: supp\.payment_method, total: supp\.total_paid \}\)/);
});

prueba('process-tour-cancellation: los suplementos regresan sus puntos como puntos', () => {
  const c = fn('process-tour-cancellation');
  assert.match(c, /rpc\("reembolsar_saldo_y_puntos", \{[\s\S]{0,400}p_points_return: supPuntos/);
  assert.doesNotMatch(c, /rpc\("update_wallet_balance"/, 'el suplemento se devolvia entero en Cash con update_wallet_balance');
});

console.log(`Cancelacion completa y puntos de cargos posteriores: ${casos} casos OK`);
