#!/usr/bin/env node
/**
 * El IVA de la comision de Stripe se lee, no se supone.
 *
 * ============================================================================
 * EL HUECO QUE CIERRA
 * ============================================================================
 *
 * `getStripeProcessorFee` leia `balance_transaction.fee` —el TOTAL— e ignoraba
 * `fee_details`, que viene en la MISMA respuesta y trae el desglose:
 *
 *     fee_details: [ { type: 'stripe_fee', amount: 19598 },
 *                    { type: 'tax',        amount:  3136 } ]
 *
 * Por eso `processor_fee_base` y `processor_fee_iva` nacian NULAS en todo
 * cobro de Stripe, mientras OpenPay si las llenaba desde el 08-sep-2026.
 *
 * NO era un agujero fiscal, y conviene que quede escrito porque la primera
 * lectura fue esa y estaba mal: `create_accounting_entry_for_booking`
 * (20260830221915) deriva `base = fee / 1.16` cuando la columna esta nula, y
 * medido el 11-sep-2026 contra los 13 cobros de Stripe en produccion esa
 * derivacion da el centavo EXACTO en los 13:
 *
 *     comision 227.34 -> /1.16 = 195.98   base real de Stripe 195.98
 *     comision  28.45 -> /1.16 =  24.53   base real de Stripe  24.53
 *     comision  82.74 -> /1.16 =  71.33   base real de Stripe  71.33
 *
 * Lo que se cierra es la DEPENDENCIA de esa suposicion. Si algun dia Stripe
 * cobra una comision sin IVA —una tarjeta extranjera facturada distinto—,
 * dividir entre 1.16 inventaria un IVA que no existe y lo acreditariamos.
 *
 * ============================================================================
 * POR QUE `base` E `iva` PUEDEN VOLVER NULAS
 * ============================================================================
 *
 * Cuando Stripe no manda `fee_details`, o cuando el desglose no suma el total,
 * se devuelven nulas A PROPOSITO en vez de derivarlas aqui. Un valor derivado
 * guardado en la columna es indistinguible de uno real; una nula deja que
 * actue la cascada de la funcion contable, que esta documentada y probada.
 * Mejor un hueco explicito que un numero inventado.
 *
 *   node scripts/test-desglose-comision-stripe.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

const FUENTE = readFileSync('supabase/functions/stripe-webhook/index.ts', 'utf8');

/**
 * Se recortan las dos funciones del fuente y se importan como modulo. Viven
 * dentro de un modulo de Deno que importa supabase-js y Stripe, asi que no se
 * pueden importar de ahi; pero son puras, asi que recortadas y con su unica
 * dependencia (`mensajeDeError`) sustituida por un doble, se pueden CORRER.
 * Correrlas es lo unico que demuestra que el desglose se lee bien — afirmar
 * sobre el texto del fuente no lo demuestra.
 *
 * Los tipos los quita Node con --experimental-strip-types, no un regex: la
 * primera version intentaba borrarlos a mano y se rompia con la firma de
 * retorno, que es justo la que cambio este arreglo.
 */
const recortar = (nombre) => {
  const inicio = FUENTE.indexOf(nombre);
  assert.ok(inicio > 0, `no se encontro ${nombre} en el fuente`);
  // Se corta en la llave de cierre a COLUMNA CERO, no contando llaves desde la
  // primera: la firma trae `Promise<{ fee: number; ... }>` y contar desde ahi
  // emparejaba la llave del TIPO DE RETORNO en vez de la del cuerpo. Ambas son
  // funciones de nivel superior, asi que su cierre es el unico `}` sin sangria.
  const fin = FUENTE.indexOf('\n}\n', inicio);
  assert.ok(fin > inicio, `no se encontro el cierre de ${nombre}`);
  return FUENTE.slice(inicio, fin + 2);
};

const dir = mkdtempSync(path.join(tmpdir(), 'comision-stripe-'));
const modulo = path.join(dir, 'recorte.ts');
writeFileSync(modulo, [
  'const mensajeDeError = (e: unknown) => String(e);',
  recortar('async function getStripeProcessorFee'),
  recortar('function columnasDeComision'),
  'export { getStripeProcessorFee, columnasDeComision };',
].join('\n\n'));

const { getStripeProcessorFee, columnasDeComision } = await import(pathToFileURL(modulo).href);

/** Los avisos del log, que en dos casos son parte de lo que se comprueba. */
const avisos = [];
const warnOriginal = console.warn;
console.warn = (...args) => { avisos.push(args.map(String).join(' ')); };
process.on('exit', () => { console.warn = warnOriginal; });

/** Un Stripe de mentira que devuelve el balance_transaction que se le indique. */
const stripeFalso = (balanceTxn) => ({
  paymentIntents: {
    retrieve: async () => ({ latest_charge: balanceTxn ? { balance_transaction: balanceTxn } : null }),
  },
});

const casos = [];

// --- 1. El caso real: se lee el desglose de fee_details --------------------
casos.push(async () => {
  // Copiado tal cual de pi_3U8Yee... (produccion, 26-ago-2026).
  const r = await getStripeProcessorFee(stripeFalso({
    fee: 22734, net: 447950,
    fee_details: [
      { amount: 3136, type: 'tax', description: 'Sales Tax' },
      { amount: 19598, type: 'stripe_fee', description: 'Stripe processing fees' },
    ],
  }), 'pi_x');
  assert.equal(r.fee, 227.34);
  assert.equal(r.net, 4479.50);
  assert.equal(r.base, 195.98, 'la base sale de fee_details, no de dividir entre 1.16');
  assert.equal(r.iva, 31.36);
});

// --- 2. El orden de fee_details VARIA, y no puede importar -----------------
casos.push(async () => {
  // Observado el 11-sep-2026: en unos cobros llega `tax` primero y en otros
  // `stripe_fee`. Leer por posicion habria intercambiado base e IVA.
  const r = await getStripeProcessorFee(stripeFalso({
    fee: 2845, net: 49655,
    fee_details: [
      { amount: 2453, type: 'stripe_fee' },
      { amount: 392, type: 'tax' },
    ],
  }), 'pi_x');
  assert.equal(r.base, 24.53);
  assert.equal(r.iva, 3.92);
});

// --- 3. Una comision SIN IVA no inventa IVA --------------------------------
casos.push(async () => {
  // Este es el escenario por el que existe el arreglo: aqui `/1.16` habria
  // dicho base 86.21 e IVA 13.79, acreditando un IVA que nadie cobro.
  const r = await getStripeProcessorFee(stripeFalso({
    fee: 10000, net: 90000,
    fee_details: [{ amount: 10000, type: 'stripe_fee' }],
  }), 'pi_x');
  assert.equal(r.base, 100, 'sin linea de tax, toda la comision es base');
  assert.equal(r.iva, 0, 'y el IVA es CERO, no el 16% derivado');
});

// --- 4. Varias lineas del mismo tipo se SUMAN ------------------------------
casos.push(async () => {
  const r = await getStripeProcessorFee(stripeFalso({
    fee: 3000, net: 97000,
    fee_details: [
      { amount: 1000, type: 'stripe_fee' },
      { amount: 1500, type: 'stripe_fee' },
      { amount: 500, type: 'tax' },
    ],
  }), 'pi_x');
  assert.equal(r.base, 25, 'tomar solo la primera linea perderia comision');
  assert.equal(r.iva, 5);
});

// --- 5. Sin fee_details: nulas, NO derivadas -------------------------------
casos.push(async () => {
  avisos.length = 0;
  const r = await getStripeProcessorFee(stripeFalso({ fee: 11600, net: 88400 }), 'pi_x');
  assert.equal(r.fee, 116, 'el total si se conoce y se guarda');
  assert.equal(r.base, null, 'derivar aqui daria un numero indistinguible de uno real');
  assert.equal(r.iva, null);
  assert.ok(avisos.some((a) => /fee_details/.test(a)), 'tiene que quedar dicho en el log');
});

// --- 6. Un desglose que no cuadra se descarta ------------------------------
casos.push(async () => {
  avisos.length = 0;
  const r = await getStripeProcessorFee(stripeFalso({
    fee: 10000, net: 90000,
    fee_details: [{ amount: 3000, type: 'stripe_fee' }, { amount: 400, type: 'tax' }],
  }), 'pi_x');
  assert.equal(r.fee, 100, 'el total se respeta');
  assert.equal(r.base, null, 'si base + iva != total, algo se leyo mal y es peor guardarlo');
  assert.equal(r.iva, null);
  assert.ok(avisos.some((a) => /incongruente/i.test(a)));
});

// --- 7. Sin balance_transaction, null ---------------------------------------
casos.push(async () => {
  assert.equal(await getStripeProcessorFee(stripeFalso(null), 'pi_x'), null,
    'sin charge no hay comision que leer; los llamadores comprueban null');
});

// --- 8. Comision en cero sigue devolviendo objeto ---------------------------
casos.push(async () => {
  const r = await getStripeProcessorFee(stripeFalso({ fee: 0, net: 10000, fee_details: [] }), 'pi_x');
  assert.ok(r, 'una comision real de 0 no es lo mismo que no poder leerla');
  assert.equal(r.fee, 0);
  assert.equal(r.net, 100);
});

// --- 9. columnasDeComision OMITE el desglose cuando es nulo ----------------
casos.push(async () => {
  // Mandar nulas BORRARIA un desglose ya guardado: misma regla que «no pisar
  // una comision buena con un cero» del #211.
  const cols = columnasDeComision({ fee: 116, net: 884, base: null, iva: null });
  assert.deepEqual(Object.keys(cols).sort(), ['net_amount', 'processor_fee']);
  assert.ok(!('processor_fee_base' in cols),
    'mandar null borraria el desglose que ya estuviera guardado');
});

// --- 10. Y lo incluye cuando lo hay ----------------------------------------
casos.push(async () => {
  const cols = columnasDeComision({ fee: 227.34, net: 4479.5, base: 195.98, iva: 31.36 });
  assert.equal(cols.processor_fee, 227.34);
  assert.equal(cols.net_amount, 4479.5);
  assert.equal(cols.processor_fee_base, 195.98);
  assert.equal(cols.processor_fee_iva, 31.36);
});

// --- 11. Los SEIS sitios del webhook pasan por el ayudante -----------------
casos.push(async () => {
  const llamadas = (FUENTE.match(/getStripeProcessorFee\(stripe,/g) || []).length;
  assert.equal(llamadas, 6,
    `se esperaban 6 consultas de comision (supplement, extras, plan, anticipo, payment_intent, membresia) y hay ${llamadas}`);

  const conAyudante = (FUENTE.match(/\.update\(columnasDeComision\(/g) || []).length;
  assert.equal(conAyudante, 6,
    `los 6 updates de comision tienen que pasar por columnasDeComision y hay ${conAyudante}`);

  // Ninguno puede volver a escribir las columnas a mano: se saltaria la regla
  // de omitir el desglose cuando es nulo.
  assert.ok(!/\.update\(\s*\{\s*processor_fee:\s*\w+\.fee/.test(FUENTE),
    'quedo un update de comision que no pasa por el ayudante');
});

let ok = 0;
for (const caso of casos) { await caso(); ok++; }
console.log(`Desglose de comision de Stripe: ${ok}/${casos.length} casos OK`);
