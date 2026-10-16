#!/usr/bin/env node
// Los puntos dobles son solo para ToursRed Cash; lo pagado con puntos da
// puntos sencillos (regla de Axel, 16-oct-2026: los puntos no son monedero).
//
// Suplementos, extras y mensualidades usaban la misma bandera para dos cosas:
// exentar el cargo por servicio (Cash O puntos, correcto) y duplicar los
// puntos ganados (Cash O puntos, incorrecto). La reserva vive en
// award_points_for_booking y la cubre test-puntos-pagados-con-puntos.sql.
//
// Esta guardia lee el codigo: la decision de duplicar debe mirar solo
// "toursred_cash", y la exencion tiene que seguir cubriendo "points".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = (f) => readFileSync(`supabase/functions/${f}/index.ts`, 'utf8');
const sinComentarios = (s) => s.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');

// Desde el 16-oct-2026 (tope del 50%) el Cash puede venir con puntos: la formula
// vive en _shared/puntosConTope.ts (Cash doble, puntos sencillos) y su prueba
// esta en test-puntos-tope-50.mjs.
const DOBLE_SOLO_CASH = /pointsEarned = payment_method === "toursred_cash" \? puntosGanadosSinPasarela\(subtotal, pesosEnPuntos\) : Math\.floor\(subtotal\);/;
const DOBLE_CON_BANDERA = /pointsEarned = isWallet(Payment)? \?/;
const EXENCION = /const isWallet(Payment)? = payment_method === "toursred_cash" \|\| payment_method === "points";/;

let casos = 0;
for (const f of ['process-supplement-payment', 'purchase-post-booking-extras']) {
  const codigo = sinComentarios(leer(f));
  assert.match(codigo, DOBLE_SOLO_CASH, `${f}: los puntos dobles deben depender solo de toursred_cash`);
  assert.doesNotMatch(codigo, DOBLE_CON_BANDERA, `${f}: no debe duplicar con la bandera que incluye "points"`);
  assert.match(codigo, EXENCION, `${f}: la exencion del cargo por servicio debe seguir cubriendo "points"`);
  casos++;
}

{
  const codigo = sinComentarios(leer('process-payment-plan-installment'));
  assert.match(codigo, /p_is_wallet_payment: payment_method === "toursred_cash",/,
    'process-payment-plan-installment: p_is_wallet_payment solo decide los dobles y debe ser solo Cash');
  assert.doesNotMatch(codigo, /p_is_wallet_payment: isWalletPayment,/,
    'process-payment-plan-installment: no debe pasar la bandera que incluye "points"');
  assert.match(codigo, EXENCION, 'process-payment-plan-installment: la exencion debe seguir cubriendo "points"');
  casos++;
}

console.log(`Puntos dobles solo con Cash: ${casos} funciones OK`);
