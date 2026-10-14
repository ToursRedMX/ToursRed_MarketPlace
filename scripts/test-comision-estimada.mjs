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

// Tarifa real de Conekta (3.5% + $2.50 + IVA), guardada con el IVA dentro
// (migracion 20261013030932): debe reproducir al centavo el cobro real del
// 12-oct-2026 (orden ord_31u32BWu46zQSZq1x, $500, fee=2320). Con la tasa vieja
// (3.29% + $2.50) daba 18.95.
assert.equal(estimarComisionProcesador(500, 4.06, 2.9), 23.2, 'la tarifa 4.06% + $2.90 debe dar los 23.20 que cobro Conekta');
assert.equal(estimarComisionProcesador(500, 3.29, 2.5), 18.95, 'control: la tasa vieja daba 18.95');
casos += 2;

// Tarifa real de Stripe (3.6% + $3.00 + IVA, tarjeta nacional), guardada con el IVA
// dentro (migracion 20261014061244). Se ancla a un cobro real: $1,338.75 con tarjeta de
// prueba (EE.UU., +0.5% internacional), Stripe reporto 67.15 = (1338.75 x 4.1% + 3) x 1.16.
// La tarifa nacional + el recargo internacional con IVA (0.5 x 1.16 = 0.58) debe dar lo mismo.
assert.equal(estimarComisionProcesador(1338.75, 4.176 + 0.58, 3.48), 67.15, 'nacional + internacional debe reproducir el cobro real de 67.15');
assert.equal(estimarComisionProcesador(1000, 4.176, 3.48), Math.round((1000 * 0.036 + 3) * 1.16 * 100) / 100, '4.176% + $3.48 es 3.6% + $3 con el IVA encima');
const migracionStripe = readFileSync('supabase/migrations/20261014061244_stripe_tarifa_real.sql', 'utf8');
assert.match(migracionStripe, /set stripe_commission_pct = 4\.176,\s+stripe_commission_fixed = 3\.48;/, 'la migracion guarda 4.176 / 3.48');
const pantalla = readFileSync('src/pages/admin/AdminSettings.tsx', 'utf8');
assert.match(pantalla, /stripe_commission_pct: 4\.176,\s+stripe_commission_fixed: 3\.48,/, 'la pantalla arranca con la misma tarifa que la base');
casos += 4;

const { comisionRealCentavos } = cargar('supabase/functions/_shared/estimarComisionProcesador.ts');
for (const [candidatos, esperado, nota] of [
  // El caso real: la API sin fee, el evento firmado con 2320.
  [[undefined, 2320], { centavos: 2320, posicion: 1 }, 'API sin fee -> gana el evento'],
  [[1500, 2320], { centavos: 1500, posicion: 0 }, 'si la API la trae, manda la API'],
  [[0, 2320], { centavos: 2320, posicion: 1 }, 'un 0 de la API no es una comision real'],
  [['2320'], { centavos: 2320, posicion: 0 }, 'acepta el numero como texto'],
  [[0, '0'], null, 'todo en 0 -> null (se estima)'],
  [[null, undefined], null, 'nada -> null (se estima)'],
  [[true, -5, 'abc', NaN, Infinity], null, 'basura no cuenta como comision'],
]) {
  // El objeto nace en el contexto de vm (otro Object.prototype): se normaliza
  // antes de comparar, si no deepStrictEqual falla con valores identicos.
  const obtenido = comisionRealCentavos(candidatos);
  assert.deepEqual(obtenido === null ? null : { ...obtenido }, esperado, `comisionRealCentavos: ${nota}`);
  casos++;
}

// Contrato sobre conekta-webhook (el codigo, no una copia): los dos defectos del
// 12-oct-2026 no deben volver.
const webhook = readFileSync('supabase/functions/conekta-webhook/index.ts', 'utf8');
// A) el evento firmado es candidato de la comision real, despues de la API.
assert.match(webhook, /comisionRealCentavos\(\[feeApi, feeEvento\]\)/, 'conekta-webhook debe probar la comision de la API y luego la del evento');
// B) la escritura final (eventos procesados) parte de la metadata ACTUAL, no de
//    la copia `tx.metadata` del inicio, que borraba processor_fee_estimada.
const bloqueFinal = webhook.slice(webhook.indexOf('// Mark event as processed (idempotency)'));
assert.ok(bloqueFinal.length < webhook.length, 'no se encontro el bloque "Mark event as processed"');
const updateFinal = bloqueFinal.slice(0, bloqueFinal.indexOf('.eq("id", tx.id)'));
assert.match(updateFinal, /metadataActual\(/, 'la escritura final debe leer la metadata actual');
assert.doesNotMatch(updateFinal, /\.\.\.\(?tx\.metadata/, 'la escritura final no debe reescribir desde tx.metadata');
casos += 3;

console.log(`estimarComisionProcesador: ${casos} casos, formula de create_accounting_entry_for_booking replicada.`);
