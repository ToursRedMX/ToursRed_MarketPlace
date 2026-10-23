// Contratos de los puntos que el pago de la reserva ANUNCIA ganar (src/lib/puntosGanados.ts): son el espejo de award_points_for_booking.
// El 23-oct-2026 el paso 4 prometia «×2 puntos» a un pago con una parte por Stripe (y a quien ya no tenia Plus), porque bastaba
// `useWallet && hasMembership`. La regla: solo gana puntos quien tiene Plus activo, y van al doble SOLO si no intervino ninguna
// pasarela (100% Cash, o Cash + puntos); lo pagado con puntos nunca da dobles.
// Importa un .ts: se corre con `node --experimental-strip-types` (como los demas contratos que leen TypeScript).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { puntosGanados, esPagoSinPasarela } from '../src/lib/puntosGanados.ts';

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('--') && !l.trim().startsWith('*')).join('\n');

let casos = 0;
const prueba = (nombre, fn) => { fn(); casos++; };
const plus = { tieneMembresiaActiva: true };

prueba('sin ToursRed Plus activo NO se promete ningun punto, ni dobles, con cualquier forma de pago', () => {
  const sin = { tieneMembresiaActiva: false };
  for (const pago of [{ pesosPasarela: 500, pesosCash: 0, pesosConPuntos: 0 }, { pesosPasarela: 0, pesosCash: 300, pesosConPuntos: 0 }, { pesosPasarela: 250, pesosCash: 300, pesosConPuntos: 50 }]) {
    assert.deepEqual(puntosGanados({ ...sin, ...pago }), { puntos: 0, esDoble: false });
  }
});

prueba('el caso de la pantalla de Axel: $300 de Cash + $250 por Stripe es SENCILLO (550), no doble', () => {
  assert.deepEqual(puntosGanados({ ...plus, pesosPasarela: 250, pesosCash: 300, pesosConPuntos: 0 }), { puntos: 550, esDoble: false });
});

prueba('100% ToursRed Cash con Plus: doble', () => {
  assert.deepEqual(puntosGanados({ ...plus, pesosPasarela: 0, pesosCash: 300, pesosConPuntos: 0 }), { puntos: 600, esDoble: true });
});

prueba('Cash + puntos sin pasarela: el Cash va doble y lo pagado con puntos sencillo', () => {
  assert.deepEqual(puntosGanados({ ...plus, pesosPasarela: 0, pesosCash: 200, pesosConPuntos: 100 }), { puntos: 500, esDoble: true });
});

prueba('solo puntos, sin Cash ni pasarela: sencillo (los puntos nunca dan dobles) y no se anuncia el ×2', () => {
  assert.deepEqual(puntosGanados({ ...plus, pesosPasarela: 0, pesosCash: 0, pesosConPuntos: 100 }), { puntos: 100, esDoble: false });
});

prueba('solo pasarela: sencillo; y el punto se redondea hacia abajo', () => {
  assert.deepEqual(puntosGanados({ ...plus, pesosPasarela: 500, pesosCash: 0, pesosConPuntos: 0 }), { puntos: 500, esDoble: false });
  assert.equal(puntosGanados({ ...plus, pesosPasarela: 100.9, pesosCash: 0, pesosConPuntos: 0 }).puntos, 100);
});

prueba('«sin pasarela» es la misma regla que el servidor: nada de pasarela y entro Cash o puntos', () => {
  assert.equal(esPagoSinPasarela({ pesosPasarela: 0, pesosCash: 1, pesosConPuntos: 0 }), true);
  assert.equal(esPagoSinPasarela({ pesosPasarela: 0, pesosCash: 0, pesosConPuntos: 1 }), true);
  assert.equal(esPagoSinPasarela({ pesosPasarela: 0, pesosCash: 0, pesosConPuntos: 0 }), false, 'sin ningun pago no hay beneficio');
  assert.equal(esPagoSinPasarela({ pesosPasarela: 0.01, pesosCash: 300, pesosConPuntos: 0 }), false, 'una parte por pasarela basta para perderlo');
});

prueba('el espejo coincide con la funcion de la base (si award_points_for_booking cambia, esta regla tambien)', () => {
  const sql = sinComentarios(leer('supabase/migrations/20261016023158_puntos_ganados_por_pesos_pagados_con_puntos.sql'));
  assert.match(sql, /IF NOT v_has_active_membership THEN\s+RETURN 0;/, 'sin Plus, cero');
  assert.match(sql, /v_is_full_wallet := v_user_payment = 0 AND \(v_toursred_cash_used > 0 OR v_points_used > 0\);/);
  assert.match(sql, /v_points_to_award := FLOOR\(p_amount_to_pay \* 2 \+ v_pesos_en_puntos\)::integer;/);
  assert.match(sql, /v_points_to_award := FLOOR\(p_amount_to_pay \+ v_pesos_en_puntos\)::integer;/);
  assert.match(sql, /v_pesos_en_puntos := v_points_used \/ 100\.0;/);
});

prueba('el paso 4 usa ese calculo, solo muestra el banner si hay puntos, y ya no promete el doble por usar Cash a secas', () => {
  const paso = sinComentarios(leer('src/pages/booking-flow/BookingFlowStep4.tsx'));
  assert.match(paso, /import \{ puntosGanados \} from '\.\.\/\.\.\/lib\/puntosGanados';/);
  assert.match(paso, /tieneMembresiaActiva: hasMembership,\s+pesosPasarela: amountToPay,\s+pesosCash: walletDiscount,\s+pesosConPuntos: pointsDiscount,/);
  assert.match(paso, /\{pointsToEarn > 0 && \(/);
  assert.ok(!/const isDoublePoints = useWallet && hasMembership/.test(paso), 'el doble ya no depende de usar Cash a secas');
  assert.ok(!/ganando el doble por pagar con ToursRed Cash y tener membresía activa/.test(paso));
});

prueba('la leyenda del saldo dice cuanto se descuenta hoy y que el resto del tour se paga antes de la salida', () => {
  const paso = sinComentarios(leer('src/pages/booking-flow/BookingFlowStep4.tsx'));
  assert.ok(!/Se aplica hasta cubrir lo que debes hoy/.test(paso), 'la frase confusa');
  assert.match(paso, /Se descuentan \$\{formatCurrencyMXN\(walletDiscount\)\} de tu saldo del pago de hoy/);
  assert.match(paso, /El resto del tour se paga antes de la salida\./);
});

console.log(`OK: ${casos} casos de los puntos que anuncia el pago.`);
