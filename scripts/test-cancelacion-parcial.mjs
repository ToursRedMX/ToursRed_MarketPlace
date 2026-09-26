#!/usr/bin/env node
/**
 * Cancelacion parcial: misma politica que la total, cada medio en su moneda,
 * y la total posterior no devuelve lo que la parcial ya devolvio.
 *
 * Tres defectos encontrados el 25-sep-2026 (bitacora, entrada 31):
 *   1. La parcial usaba dias fijos (15/7) y la total la politica del tour.
 *   2. La parcial acreditaba en Cash la parte pagada con puntos.
 *   3. La total no restaba lo consumido por parciales: devolvia dos veces.
 *
 * La regla del dinero vive en SQL (migracion 20260925240000, con ASSERT). Aqui
 * se prueba la politica compartida (_shared/politicaCancelacion.ts) y que los
 * llamadores usen esas piezas y no su propia cuenta.
 *
 * USO
 *
 *   node scripts/test-cancelacion-parcial.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync, globSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const js = ts.transpileModule(readFileSync('supabase/functions/_shared/politicaCancelacion.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const contexto = { exports: {}, Date };
vm.runInNewContext(js, contexto);
const { politicaDelTour, salidaDelTour } = contexto.exports;

// ── 1. La politica del tour ────────────────────────────────────────────────
const porDefecto = {};
const receptivo48 = { tour_type: 'receptivo', flexible_hours: 48, flexible_refund_percentage: 100, moderate_hours: 24, moderate_refund_percentage: 60 };

const casos = [
  // [tour, horas, pendiente, tipo, pct, nota]
  [porDefecto, 120, false, '100_percent', 1, 'defaults: 5 dias -> 100%'],
  [porDefecto, 30, false, '50_percent', 0.5, 'defaults: 30 h -> 50%'],
  [porDefecto, 10, false, 'no_refund', 0, 'defaults: 10 h -> nada'],
  // El caso que motivo la decision: receptivo de 48 h, 5 dias antes.
  [receptivo48, 120, false, '100_percent', 1, 'receptivo 48 h, 5 dias: 100% (la parcial daba 0%)'],
  [receptivo48, 30, false, '50_percent', 0.6, 'receptivo, moderada al 60%'],
  [{ ...receptivo48, cancellation_not_allowed: true }, 500, false, 'no_refund', 0, 'no permite cancelar'],
  [receptivo48, 1, true, 'pending_approval', 1, 'pendiente de aprobacion: todo'],
  [{ flexible_refund_percentage: 80 }, 100, false, '50_percent', 0.8, 'flexible al 80% se etiqueta como parcial'],
  [{ moderate_refund_percentage: 0 }, 30, false, 'no_refund', 0, 'moderada al 0%'],
  [porDefecto, 48, false, '100_percent', 1, 'justo en el limite flexible'],
];
for (const [tour, horas, pendiente, tipo, pct, nota] of casos) {
  const r = politicaDelTour(tour, horas, pendiente);
  assert.equal(r.policyType, tipo, `${nota}: tipo`);
  assert.equal(r.refundPct, pct, `${nota}: porcentaje`);
}

// ── 2. La fecha de salida ──────────────────────────────────────────────────
const ahora = new Date('2026-09-25T12:00:00Z');
let s = salidaDelTour({ tour_type: 'receptivo', start_date: '2026-10-01' }, { selected_date: '2026-10-10', selected_time: '08:30:00' }, ahora);
assert.equal(s.fechaParaRegistro, '2026-10-10', 'receptivo: manda la fecha elegida');
s = salidaDelTour({ tour_type: 'receptivo', start_date: '2026-10-01' }, {}, ahora);
assert.equal(s.fechaParaRegistro, '2026-10-01', 'receptivo sin fecha elegida: la del tour');
s = salidaDelTour({ tour_type: 'receptivo' }, {}, ahora);
assert.equal(s.fechaParaRegistro, '2026-09-26', 'receptivo sin nada: manana');
assert.equal(salidaDelTour({ tour_type: 'grupal' }, {}, ahora), null, 'grupal sin fecha: null');

// ── 3. Los llamadores usan las piezas compartidas ──────────────────────────
const sinComentarios = (f) => readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const parcial = sinComentarios('supabase/functions/process-partial-cancellation/index.ts');
const total = sinComentarios('supabase/functions/process-traveler-cancellation/index.ts');

assert.match(parcial, /politicaDelTour\(/, 'la parcial usa la politica del tour');
assert.match(total, /politicaDelTour\(/, 'la total usa la politica del tour');
assert.doesNotMatch(parcial, /daysBeforeTour\s*>=\s*(15|7)/, 'la parcial ya no usa dias fijos');
assert.match(parcial, /rpc\("reparto_parcial"/, 'la vista previa usa la regla de la base');
assert.match(parcial, /rpc\("procesar_reembolso_parcial"/, 'la ejecucion acredita Cash y puntos juntos');
assert.doesNotMatch(parcial, /rpc\("update_wallet_balance"/,
  'la parcial no acredita Cash por su cuenta: asi convertia puntos en dinero');
assert.match(parcial, /points_share:\s*pointsShare/, 'la parcial registra los puntos que consumio');

// ── 3b. reparto_parcial multiplica antes de dividir ─────────────────────────
// La primera version hacia floor(puntos * least(1, parte / principal)): parte/
// principal suele ser periodico y el floor perdia un punto por parcial (44bec1b8:
// 22,499 en vez de 22,500). Se mira la ULTIMA migracion que define la funcion.
const definiciones = globSync('supabase/migrations/*.sql').sort()
  .filter((f) => /CREATE OR REPLACE FUNCTION public\.reparto_parcial\(/.test(readFileSync(f, 'utf8')));
const ultima = readFileSync(definiciones.at(-1), 'utf8');
assert.match(ultima, /\*\s*least\(v_parte, p_principal\)\s*\/\s*p_principal/,
  `${definiciones.at(-1)}: reparto_parcial tiene que multiplicar antes de dividir`);
assert.doesNotMatch(ultima, /least\(1, v_parte \/ p_principal\)/,
  `${definiciones.at(-1)}: dividir primero pierde un punto por truncamiento`);

// ── 4. La base descuenta lo consumido; el modal tambien ────────────────────
const migracion = readFileSync('supabase/migrations/20260925240000_cancelacion_parcial_por_medio_y_saldo.sql', 'utf8');
assert.match(migracion, /v_consumido := public\.consumido_por_parciales\(p_booking_id\)/,
  'process_cancellation_refund tiene que restar lo consumido por parciales');
assert.match(migracion, /coalesce\(v_points_used, 0\) - \(public\.consumido_por_parciales\(p_booking_id\)\)\.puntos/,
  'refund_points_for_cancellation tiene que restar los puntos consumidos por parciales');
const modal = readFileSync('src/pages/traveler/TravelerBookings.tsx', 'utf8');
assert.match(modal, /politica\.refundAmountToTraveler - pct \* principalConsumido/,
  'la vista previa de la cancelacion total resta lo consumido por parciales');

console.log(`Cancelacion parcial: ${casos.length} casos de politica, 4 de fecha y 12 comprobaciones de uso.`);
