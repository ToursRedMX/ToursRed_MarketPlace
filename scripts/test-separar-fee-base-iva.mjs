// MercadoPago manda la comision como un solo monto con IVA incluido
// (`fee_details`), y mercadopago-webhook solo guardaba `processor_fee`:
// `processor_fee_base` y `processor_fee_iva` quedaban NULL en los cinco
// sitios que escriben la comision (pendiente 6 de la entrada 33). Esta
// prueba corre separarFeeBaseIva() -- la misma formula que
// create_accounting_entry_for_booking ya usa como respaldo (migracion
// 20260804042551) -- y confirma que coincide con ella.
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

const { separarFeeBaseIva } = cargar('supabase/functions/_shared/separarFeeBaseIva.ts');

let casos = 0;
for (const [feeTotal, baseEsperada, ivaEsperada] of [
  [0, 0, 0],
  // 116 / 1.16 = 100 exacto: caso limpio para confirmar el orden de la resta.
  [116, 100, 16],
  // Un fee real de MercadoPago (monto cualquiera con IVA incluido).
  [59.50, 51.29, 8.21],
]) {
  const { base, iva } = separarFeeBaseIva(feeTotal);
  assert.equal(base, baseEsperada, `separarFeeBaseIva(${feeTotal}).base = ${base}, se esperaba ${baseEsperada}`);
  assert.equal(iva, ivaEsperada, `separarFeeBaseIva(${feeTotal}).iva = ${iva}, se esperaba ${ivaEsperada}`);
  // base + iva debe reconstruir el total (al centavo): es la aserción que
  // de verdad importa para la contabilidad, no los numeros exactos.
  assert.equal(Math.round((base + iva) * 100) / 100, feeTotal, `base (${base}) + iva (${iva}) no reconstruye el fee total (${feeTotal})`);
  casos++;
}

console.log(`separarFeeBaseIva: ${casos} casos, base + iva reconstruye el total en cada uno.`);
