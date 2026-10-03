// Conekta no manda su comision real (o la manda en 0): medido el 03-oct-2026,
// 14 de 14 cobros historicos quedaron con processor_fee = 0.00 y
// net_amount = amount (pendiente 5 de la entrada 33). conekta-webhook ahora
// estima la comision con estimarComisionProcesador(), la MISMA formula que
// create_accounting_entry_for_booking ya usa como respaldo (migracion
// 20260804042551) para los cinco procesadores -- esta prueba confirma que
// coincide con esa formula: ROUND((monto * pct / 100) + fijo, 2).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';

function cargar(ruta) {
  const fuente = readFileSync(ruta, 'utf8');
  const compilado = ts.transpileModule(fuente, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compilado, { exports, module: { exports } });
  return exports;
}

const { estimarComisionProcesador } = cargar('supabase/functions/_shared/estimarComisionProcesador.ts');

let casos = 0;
for (const [monto, pct, fijo, esperado] of [
  // Las dos reservas reales que disparan check_cobros_sin_comision() a diario.
  [300, 3.29, 2.5, 12.37],
  [1732.50, 3.29, 2.5, 59.5],
  // Casos simples, para el redondeo sin arrastre de otros decimales.
  [100, 3.29, 2.5, 5.79],
  [0, 3.29, 2.5, 2.5],
  // Tasas de Stripe, para confirmar que la funcion es generica y no trae
  // nada de Conekta clavado adentro (la tasa la decide quien la llama).
  [1000, 3.1034, 2.5862, 33.62],
]) {
  const resultado = estimarComisionProcesador(monto, pct, fijo);
  assert.equal(resultado, esperado, `estimarComisionProcesador(${monto}, ${pct}, ${fijo}) = ${resultado}, se esperaba ${esperado}`);
  casos++;
}

console.log(`estimarComisionProcesador: ${casos} casos, formula de create_accounting_entry_for_booking replicada.`);
