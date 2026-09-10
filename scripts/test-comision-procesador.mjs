#!/usr/bin/env node
/**
 * Guardia de comision de procesador.
 *
 * QUE VIGILA
 *
 * Que ningun camino de cobro inserte `processor_fee: 0` y lo deje ahi. El
 * patron correcto en este repo es insertar en 0 --porque la comision no se
 * conoce hasta consultar al procesador-- y ACTUALIZARLA justo despues.
 *
 * POR QUE
 *
 * Medido el 10-sep-2026 sobre `payment_transactions`: de 41 cobros con monto,
 * 30 tenian `net_amount` igual a `amount`, o sea la comision sin descontar.
 * La mayoria eran anteriores al codigo que la captura --Conekta la agrego el
 * 04-ago y sus 12 cobros son del 31-jul--, pero uno no:
 *
 *     charge_context 'booking_deposit' ...... si desde el 26-ago
 *     charge_context 'membership' ........... NO, el 08-sep
 *
 * El camino de membresia insertaba processor_fee en 0 y, a diferencia de los
 * otros cinco contextos, no hacia el update posterior. Toda membresia cobrada
 * figuraba con neto igual a bruto y su costo no llegaba al ERP.
 *
 * Un 0 es el peor valor posible para esto: no se distingue de "sin comision" y
 * pasa por dato bueno en cualquier reporte de margen.
 *
 * COMO LO COMPRUEBA
 *
 * Por cada `processor_fee: 0` en un insert, busca en las ~60 lineas siguientes
 * un `.update(` que toque `processor_fee`, o un `console.warn` que reconozca
 * que se queda en 0. Lo segundo se acepta a proposito: hay caminos donde el
 * procesador no devuelve la comision, y dejar constancia es mejor que fingir
 * que se capturo.
 *
 * USO
 *
 *   node scripts/test-comision-procesador.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, globSync } from 'node:fs';

const VENTANA = 60;

const hallazgos = [];
let insertsRevisados = 0;

for (const archivo of globSync('supabase/functions/*/index.ts').sort()) {
  const ruta = archivo.replace(/\\/g, '/');
  const lineas = readFileSync(archivo, 'utf8').split(/\r?\n/);

  lineas.forEach((linea, i) => {
    if (!/processor_fee:\s*0\b/.test(linea)) return;
    if (/^\s*(\/\/|\*)/.test(linea)) return;
    insertsRevisados++;

    // Un insert con `status: 'pending'` NO es un hallazgo: el cobro todavia no
    // ocurrio, asi que la comision no se puede saber y el 0 es un marcador
    // legitimo que el webhook rellena al confirmarse. Sin esta exclusion la
    // guardia acusa al patron normal del repo — que es lo que hacia en su
    // primera version, con `create-conekta-order` y el checkout de Conekta de
    // `process-supplement-payment`.
    const alrededor = lineas.slice(Math.max(0, i - 10), i + 10).join('\n');
    if (/status:\s*["']pending["']/.test(alrededor)) return;

    // La ventana cuenta lineas de CODIGO, no comentarios ni blancos. Sin esto,
    // alargar un comentario dentro de la ventana empuja el `.update` fuera y la
    // guardia canta un falso positivo — paso al escribirla: el arreglo de
    // membresia lleva 20 lineas de comentario y quedaba reportado como si no
    // actualizara nada. Mismo criterio de ignorar comentarios que
    // check-edge-deps.mjs y check-audit-context.mjs.
    const despues = lineas
      .slice(i + 1)
      .map((l) => l.replace(/\/\/.*$/, '').trim())
      .filter((l) => l !== '' && !l.startsWith('*') && !l.startsWith('/*'))
      .slice(0, VENTANA)
      .join('\n');

    const seActualiza = /\.update\(\s*\{[^}]*processor_fee/s.test(despues)
      || /update\(\{ processor_fee/.test(despues);
    const seReconoce = /console\.warn\([^)]*(?:comision|processor_fee|queda en 0)/is.test(despues);

    if (seActualiza || seReconoce) return;

    // Que contexto es, para que el mensaje sirva de algo.
    const contexto = /charge_context:\s*['"]([a-z_]+)['"]/.exec(
      lineas.slice(i, i + 8).join('\n'),
    )?.[1] ?? '(sin charge_context cerca)';

    hallazgos.push({ ruta, linea: i + 1, contexto });
  });
}


// ---------------------------------------------------------------------------
// Linea base
// ---------------------------------------------------------------------------
// Son 17 sitios en 5 funciones. Exigir cero pediria tocar cinco caminos de
// cobro a la vez, y una guardia que nace en 17 se aprende a ignorar — que es
// la peor forma de perderla. Mismo criterio que `tipos-edge`, que nacio con
// 380 errores tolerados: se congela lo que hay y se bloquea lo NUEVO.
//
// La firma es archivo + charge_context, SIN numero de linea: un renglon de mas
// en cualquiera de esos archivos convertiria todo lo demas en falsos "nuevos".
// Misma razon que documenta check-edge-types.mjs.
const BASE = 'scripts/comision-procesador-base.txt';

const firmaDe = (h) => `${h.ruta}|${h.contexto}`;
const cuentas = new Map();
for (const h of hallazgos) cuentas.set(firmaDe(h), (cuentas.get(firmaDe(h)) ?? 0) + 1);

if (process.argv.includes('--actualizar')) {
  const texto = [...cuentas.entries()].sort().map(([f, n]) => `${n} ${f}`).join('\n');
  writeFileSync(BASE, texto + '\n');
  console.log(`Linea base reescrita: ${hallazgos.length} sitios en ${cuentas.size} firmas.`);
  console.log('Hacerlo es una decision consciente, no el estado normal.');
  process.exit(0);
}

const base = new Map();
try {
  for (const linea of readFileSync(BASE, 'utf8').split('\n')) {
    const m = /^(\d+)\s+(.+)$/.exec(linea.trim());
    if (m) base.set(m[2], Number(m[1]));
  }
} catch {
  console.error(`No se pudo leer ${BASE}. Generala con --actualizar.`);
  process.exit(2);
}

const nuevos = [];
for (const [firma, n] of cuentas) {
  const previo = base.get(firma) ?? 0;
  if (n > previo) nuevos.push({ firma, n, previo });
}
const resueltos = [...base.entries()].filter(([f, n]) => (cuentas.get(f) ?? 0) < n);

console.log('Comision de procesador');
console.log(`Inserciones con processor_fee en 0 ... ${insertsRevisados}`);
console.log(`De esas, sin actualizar despues ...... ${hallazgos.length}`);
console.log(`En la linea base ..................... ${[...base.values()].reduce((a, b) => a + b, 0)}`);
console.log('');

if (resueltos.length > 0) {
  console.log('Arreglados (baja la linea base con --actualizar):');
  for (const [f, n] of resueltos) console.log(`  ${f}   ${n} -> ${cuentas.get(f) ?? 0}`);
  console.log('');
}

if (nuevos.length === 0) {
  assert.ok(insertsRevisados > 0, 'no se hallo ningun processor_fee: 0; la guardia se quedo sin objeto');
  console.log('Sin cobros nuevos que dejen la comision en 0.');
  process.exit(0);
}

console.log(`NUEVOS (${nuevos.length}):`);
for (const n of nuevos) console.log(`  ${n.firma}   ${n.previo} -> ${n.n}`);
console.log('');
console.log('Como se arregla: despues del insert, consulta la comision al procesador y');
console.log('actualiza processor_fee y net_amount. Si el procesador no la devuelve en ese');
console.log('momento, deja un console.warn diciendolo — un 0 silencioso pasa por dato bueno');
console.log('y el margen que reporta el ERP sale inflado.');
process.exit(1);
