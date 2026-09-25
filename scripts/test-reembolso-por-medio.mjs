#!/usr/bin/env node
/**
 * Reembolso por medio de pago: los puntos vuelven como puntos y el dinero
 * como ToursRed Cash, cada uno al porcentaje de la politica.
 *
 * La regla vive en dos sitios, a proposito y atada aqui:
 *   - `public.reembolso_por_medio()` (migracion 20260925230000), la que mueve
 *     el dinero dentro de `process_cancellation_refund`.
 *   - `src/utils/reembolsoPorMedio.ts`, la que muestra el modal.
 * Cada vector se corre en TypeScript y se exige que la migracion lo afirme
 * con los mismos argumentos. Cambiar una regla sin la otra rompe esto.
 *
 * Tambien comprueba que ninguna Edge Function vuelva a sumar
 * `deposit_amount + toursred_cash_used`: `deposit_amount` ya incluye lo
 * pagado con Cash, y las dos de reagendado devolvian el Cash dos veces.
 *
 * USO
 *
 *   node scripts/test-reembolso-por-medio.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync, globSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const js = ts.transpileModule(readFileSync('src/utils/reembolsoPorMedio.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const contexto = { exports: {} };
vm.runInNewContext(js, contexto);
const { reembolsoPorMedio } = contexto.exports;

const migracion = readFileSync(
  'supabase/migrations/20260925230000_reembolso_en_la_moneda_en_que_se_pago.sql', 'utf8');

// [monto, puntos, porcentaje, incluyePuntos, cash, puntos, nota]
const VECTORES = [
  [500, 25000, 1, true, 250, 25000, 'el caso de Axel: 100%, mitad y mitad'],
  [250, 25000, 0.5, true, 125, 12500, '50%: la mitad de cada cosa'],
  [0, 25000, 0, true, 0, 0, 'no_refund: nada'],
  [50, 25000, 0, true, 50, 0, 'no_refund con opcionales reembolsables'],
  [500, 0, 1, true, 500, 0, 'sin puntos: igual que antes'],
  [250, 25000, 1, false, 250, 25000, 'monto sin puntos (pago no completado)'],
  [100, 25000, 1, true, 0, 25000, 'nunca negativo'],
];

for (const [monto, pts, pct, incluye, cash, puntos, nota] of VECTORES) {
  const r = reembolsoPorMedio(monto, pts, pct, incluye);
  assert.equal(r.cash, cash, `TypeScript, ${nota}: cash`);
  assert.equal(r.puntos, puntos, `TypeScript, ${nota}: puntos`);
  const llamada = `reembolso_por_medio(${monto}, ${pts}, ${pct}, ${incluye})`;
  assert.ok(migracion.includes(llamada),
    `La migracion no afirma ${llamada} (${nota}). Las dos reglas tienen que cumplir los mismos vectores.`);
}

// Los bordes que solo tienen sentido en TypeScript.
assert.equal(reembolsoPorMedio(250.01, 25001, 0.5).puntos, 12500, 'puntos impares: hacia abajo');
assert.deepEqual({ ...reembolsoPorMedio(500, 25000, null) }, { cash: 250, puntos: 25000 }, 'porcentaje nulo = 100%');
assert.deepEqual({ ...reembolsoPorMedio(500, 25000, 1.5) }, { cash: 250, puntos: 25000 }, 'porcentaje > 1 se acota');
assert.deepEqual({ ...reembolsoPorMedio(500, null, 1) }, { cash: 500, puntos: 0 }, 'points_used nulo');

// La RPC usa la regla, y guarda el porcentaje en el mismo UPDATE que cancela.
assert.match(migracion, /v_reparto := public\.reembolso_por_medio\(p_refund_amount, v_points_used, v_pct, p_monto_incluye_puntos\)/,
  'process_cancellation_refund tiene que calcular el Cash con reembolso_por_medio');
assert.match(migracion, /cancellation_points_refund_pct = v_pct/,
  'el porcentaje tiene que quedar en la reserva para que el trigger devuelva los puntos correctos');
assert.match(migracion, /DROP FUNCTION IF EXISTS public\.process_cancellation_refund\(uuid, numeric, text, text, text, boolean, text, numeric\)/,
  'la firma vieja se borra: dos sobrecargas con defaults confunden a PostgREST');

// El viajero pasa su porcentaje; el pago no completado avisa que su monto no incluye puntos.
const viajero = readFileSync('supabase/functions/process-traveler-cancellation/index.ts', 'utf8');
assert.match(viajero, /p_porcentaje_puntos:\s*refundPct/, 'process-traveler-cancellation tiene que pasar su porcentaje');
const pago = readFileSync('supabase/functions/process-payment-cancellation/index.ts', 'utf8');
assert.match(pago, /p_monto_incluye_puntos:\s*false/, 'process-payment-cancellation pasa solo Cash, sin puntos');

// Nadie suma deposit_amount + toursred_cash_used.
const sumaDoble = /deposit_amount[^;\n]{0,80}\+[^;\n]{0,80}toursred_cash_used|toursred_cash_used[^;\n]{0,80}\+[^;\n]{0,80}deposit_amount|depositAmount\s*\+\s*toursredCashUsed|refundAmount\s*\+\s*toursredCashUsed/;
for (const archivo of globSync('supabase/functions/*/index.ts')) {
  const limpio = readFileSync(archivo, 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(limpio, sumaDoble,
    `${archivo} suma deposit_amount y toursred_cash_used: deposit_amount ya incluye el Cash.`);
}

console.log(`Reembolso por medio: ${VECTORES.length} vectores con paridad TS <-> SQL, 4 bordes y 6 comprobaciones de uso.`);
