/**
 * Aprobar una reserva NO mueve el saldo del viajero (13-oct-2026).
 *
 * EL DEFECTO: `approve-booking` lo dispara la AGENCIA. Si los puntos y el ToursRed Cash comprometidos al crear
 * la reserva cubrian el 100%, esa funcion descontaba el saldo y los puntos del viajero y confirmaba la reserva
 * —gastar saldo sin que el viajero escribiera su codigo MFA, que exigen todos los demas caminos de gasto—.
 * Medido contra la base: 0 reservas habian pasado por ahi (1 sola reserva de aprobacion manual con saldo).
 *
 * LO QUE VIGILA
 *  1. approve-booking ya no toca el monedero ni los puntos, ni confirma ni marca pagada la reserva; aprobar abre
 *     la ventana de pago de 12 h y responde auto_confirmed:false (la agencia ya manda el aviso correcto).
 *  2. coberturaReservaAprobada (la logica pura que usa «Completar Pago»): manda los puntos y el Cash
 *     COMPROMETIDOS al RPC, para que confirm-booking-wallet-payment —que exige el codigo— pueda terminar una
 *     reserva cubierta por completo. Con `p_points_to_use: 0` el RPC la rechaza («Pago insuficiente»).
 *  3. TravelerBookings usa ese calculo y sigue pasando por fetchWithStepUp.
 *
 * LIMITES HONESTOS: analisis estatico + la funcion pura ejecutada; no corre la Edge Function ni la pantalla.
 *
 *   node scripts/test-aprobacion-no-gasta-saldo.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');
const sinComentarios = (texto) => texto.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
let n = 0;
const prueba = (nombre, fn) => { fn(); console.log(`ok ${++n} - ${nombre}`); };

const aprobar = sinComentarios(leer('supabase/functions/approve-booking/index.ts'));
prueba('approve-booking: no descuenta Cash ni puntos, ni confirma ni marca pagada la reserva', () => {
  for (const prohibido of ['update_wallet_balance', 'deduct_points', 'payment_status', 'paid_at', 'toursred_cash_used', 'points_used', "status: \"confirmed\"", 'apply_membership_service_fee_exemption', 'generate-booking-cfdi'])
    assert.ok(!aprobar.includes(prohibido), `approve-booking no debe contener «${prohibido}»`);
});
prueba('approve-booking: aprobar solo abre la ventana de 12 h y responde auto_confirmed:false', () => {
  assert.match(aprobar, /approval_status: "approved"[\s\S]{0,200}payment_due_at: paymentDueAt/);
  assert.match(aprobar, /12 \* 60 \* 60 \* 1000/);
  assert.equal([...aprobar.matchAll(/auto_confirmed: true/g)].length, 0, 'ya no existe la respuesta auto_confirmed:true');
  assert.equal([...aprobar.matchAll(/auto_confirmed: false/g)].length, 2, 'rechazo y aprobacion');
});

function cargar() {
  const fuente = readFileSync(new URL('../src/lib/coberturaReservaAprobada.ts', import.meta.url), 'utf8');
  const contexto = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fuente, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, contexto);
  return contexto.exports.coberturaReservaAprobada;
}
const cobertura = cargar();
const igual = (real, esperado) => assert.deepEqual({ ...real }, esperado);
prueba('cobertura: los puntos cubren todo -> se mandan los puntos comprometidos y no queda nada por cobrar', () => {
  igual(cobertura({ user_payment: 100, points_used: 10000 }, 0), { puntosAportados: 10000, efectivoAportado: 0, montoACobrar: 0 });
});
prueba('cobertura: el Cash comprometido cubre todo (el viajero no eligio otro monto)', () => {
  igual(cobertura({ user_payment: 100, toursred_cash_used: 100 }, 0), { puntosAportados: 0, efectivoAportado: 100, montoACobrar: 0 });
});
prueba('cobertura: puntos + Cash comprometidos', () => {
  igual(cobertura({ user_payment: 100, points_used: 4000, toursred_cash_used: 60 }, 0), { puntosAportados: 4000, efectivoAportado: 60, montoACobrar: 0 });
});
prueba('cobertura: lo que el viajero elige en el modal manda sobre lo comprometido', () => {
  igual(cobertura({ user_payment: 100, toursred_cash_used: 30 }, 50), { puntosAportados: 0, efectivoAportado: 50, montoACobrar: 50 });
});
prueba('cobertura: sin nada comprometido y sin eleccion, todo queda por cobrar', () => {
  igual(cobertura({ user_payment: 100 }, 0), { puntosAportados: 0, efectivoAportado: 0, montoACobrar: 100 });
});
prueba('cobertura: cubierto a medias deja el resto por cobrar', () => {
  igual(cobertura({ user_payment: 100, points_used: 5000 }, 0), { puntosAportados: 5000, efectivoAportado: 0, montoACobrar: 50 });
  igual(cobertura({ user_payment: 100, toursred_cash_used: 30 }, 0), { puntosAportados: 0, efectivoAportado: 30, montoACobrar: 70 });
});
prueba('cobertura: montos como texto (numeric de Postgres), deposito como respaldo y nunca negativa', () => {
  igual(cobertura({ user_payment: '100.00', points_used: '10000', toursred_cash_used: '0' }, 0), { puntosAportados: 10000, efectivoAportado: 0, montoACobrar: 0 });
  igual(cobertura({ deposit_amount: 80, toursred_cash_used: 20 }, 0), { puntosAportados: 0, efectivoAportado: 20, montoACobrar: 60 });
  assert.equal(cobertura({ user_payment: 50, points_used: 10000 }, 0).montoACobrar, 0, 'sobrecubierta no da negativo');
  igual(cobertura({}, 0), { puntosAportados: 0, efectivoAportado: 0, montoACobrar: 0 });
});

const viajero = leer('src/pages/traveler/TravelerBookings.tsx');
prueba('TravelerBookings: «Completar Pago» manda los puntos y el Cash comprometidos, por el camino con codigo MFA', () => {
  assert.match(viajero, /const cobertura = coberturaReservaAprobada\(booking, toursRedCashToUse\);/);
  assert.match(viajero, /if \(amountToCharge <= 0 \|\| cobertura\.montoACobrar <= 0\) \{\s*const walletRes = await fetchWithStepUp\(/);
  assert.match(viajero, /p_points_to_use: cobertura\.puntosAportados,\s*p_cash_to_use: cobertura\.efectivoAportado,/);
  assert.doesNotMatch(viajero, /p_points_to_use: 0,\s*p_cash_to_use: toursRedCashToUse/, 'ya no manda 0 puntos');
});

console.log(`${n} pruebas de aprobacion que no gasta saldo OK.`);
