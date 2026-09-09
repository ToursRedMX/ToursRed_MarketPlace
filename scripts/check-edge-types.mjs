#!/usr/bin/env node
/**
 * Type-check de las Edge Functions con linea base.
 *
 * El problema que resuelve: `npm run typecheck` corre `tsc -p tsconfig.app.json`
 * y ese tsconfig tiene `"include": ["src"]`. Las ~173 funciones de
 * supabase/functions/ no las type-checkea NADA, ni en local ni en CI. Lo
 * detectamos el 01-sep-2026 a raiz de generate-booking-cfdi, donde un
 * `booking as {...}` escondia que el .select() no pedia tax_treatment: el
 * codigo leia una columna que la consulta nunca traia y ni tsc ni el runtime
 * decian nada.
 *
 * Por que linea base y no "cero errores": cuando esto se escribio habia 380
 * errores preexistentes, y exigir cero habria pedido una limpieza de semanas
 * antes de tener cualquier red. La linea base daba la red desde el dia uno: los
 * errores viejos se toleraban, uno NUEVO fallaba.
 *
 * Desde el 08-sep-2026 la linea base esta VACIA: se limpiaron los 380. O sea
 * que hoy el mecanismo equivale a "cero errores" — cualquier error de tipos en
 * supabase/functions/ rompe el check. El mecanismo de linea base se conserva a
 * proposito: si algun dia hay que absorber una tanda grande (un salto de
 * version de supabase-js, por ejemplo), `--update` vuelve a dar la red sin
 * apagar el check. Mantenerla vacia es lo deseable; llenarla es una decision
 * consciente, no el estado normal.
 *
 * Por que la firma no incluye linea ni columna: si la incluyera, agregar una
 * linea en blanco arriba convertiria 30 errores viejos en 30 "nuevos". La firma
 * es archivo + codigo + mensaje, y se compara por CANTIDAD: si un archivo pasa
 * de 2 a 3 ocurrencias del mismo error, esa tercera es nueva.
 *
 * Nota de conteo: el script cuenta BLOQUES `TSxxxx [ERROR]`, y deno reporta
 * un numero ligeramente menor porque algunas lineas (p.ej. TS2771 "The last
 * overload is declared here") son informacion relacionada de otro error, no
 * errores independientes. Los dos numeros se imprimen para que la diferencia
 * no parezca un bug. La comparacion es por firma, asi que no la afecta.
 *
 * Uso:
 *   node scripts/check-edge-types.mjs            # compara contra la linea base
 *   node scripts/check-edge-types.mjs --update   # regenera la linea base
 *
 * Codigos de salida:
 *   0  sin errores nuevos (puede haber resueltos: se reportan)
 *   1  hay errores nuevos
 *   2  error de invocacion (deno ausente, no se pudo correr, salida ilegible)
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASELINE = 'scripts/edge-check/baseline.txt';
const CONFIG = 'scripts/edge-check/deno.json';
const OBJETIVO = 'supabase/functions/';
const DENO = process.env.DENO_BIN || 'deno';

const actualizar = process.argv.includes('--update');

// ---------- correr deno check ----------
const res = spawnSync(
  DENO,
  ['check', '--node-modules-dir=auto', '--config', CONFIG, OBJETIVO],
  { encoding: 'utf8', shell: process.platform === 'win32' },
);

if (res.error) {
  console.error(`ERROR: no se pudo ejecutar "${DENO}": ${res.error.message}`);
  console.error('Instala Deno o exporta DENO_BIN con la ruta al binario.');
  process.exit(2);
}

const salida = `${res.stdout || ''}${res.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '');

// Distinguir "sin errores" de "no corrio" es la razon de ser de este bloque:
// lo segundo NO puede pasar por lo primero.
//
// La version anterior buscaba el texto 'error: Type checking failed' para
// detectar un fallo. Eso deja fuera todos los modos de fallo que no son de
// tipos. Detectado el 07-sep-2026 con jsr.io devolviendo 403: `deno check`
// murio sin poder resolver un import, imprimio su propio error, y este script
// reporto "Bloques de error ahora: 0 ... Sin errores nuevos" y salio con 0.
// O sea, un corte de red convertia `tipos-edge` —que es un check REQUERIDO—
// en un sello de goma.
//
// El codigo de salida es la unica evidencia POSITIVA de que el chequeo corrio:
//   0     -> corrio y no encontro nada
//   != 0  -> corrio y encontro errores, O fallo por otra causa
// Para el segundo caso se exige ademas ver errores de tipos de verdad.
const contadorFinal = salida.match(/Found (\d+) errors?\./);
const hayErroresDeTipos = Boolean(contadorFinal) || /^TS\d+ \[ERROR\]/m.test(salida);
const salioLimpio = res.status === 0;

const abortar = (motivo) => {
  console.error(`ERROR: ${motivo}`);
  console.error('No se puede concluir nada, y esto NO es "sin errores nuevos".');
  console.error('--- ultimas lineas de la salida de deno ---');
  console.error(salida.trim().split('\n').slice(-15).join('\n') || '(sin salida)');
  process.exit(2);
};

if (res.status === null) {
  abortar(`"${DENO}" murio por señal (${res.signal ?? 'desconocida'}).`);
}

if (!salioLimpio && !hayErroresDeTipos) {
  abortar(`deno check fallo (codigo ${res.status}) sin reportar ni un error de tipos.`);
}

if (salioLimpio && hayErroresDeTipos) {
  abortar('deno check salio con codigo 0 pero reporto errores de tipos.');
}

// ---------- parsear a firmas ----------
const RAIZ = process.cwd().split(String.fromCharCode(92)).join('/').replace(/^([a-zA-Z]):/, (_, d) => `${d.toUpperCase()}:`);

function rutaRelativa(url) {
  let p = decodeURIComponent(url).replace(/^file:\/\/\//, '').split(String.fromCharCode(92)).join('/');
  p = p.replace(/^([a-zA-Z]):/, (_, d) => `${d.toUpperCase()}:`);
  if (p.startsWith(`${RAIZ}/`)) p = p.slice(RAIZ.length + 1);
  const i = p.indexOf('supabase/functions/');
  return i >= 0 ? p.slice(i) : p;
}

const lineas = salida.split('\n');
const firmas = new Map();
let total = 0;

for (let i = 0; i < lineas.length; i++) {
  const m = lineas[i].match(/^(TS\d+) \[ERROR\]: (.*)$/);
  if (!m) continue;
  total++;
  const [, codigo, mensaje] = m;

  // La ruta viene en la primera linea "at file://..." del bloque.
  let ruta = '(sin ubicacion)';
  for (let j = i + 1; j < lineas.length; j++) {
    if (/^TS\d+ \[ERROR\]/.test(lineas[j])) break;
    const a = lineas[j].match(/^\s*at (file:\/\/\/\S+?):\d+:\d+\s*$/);
    if (a) { ruta = rutaRelativa(a[1]); break; }
  }

  // Algunos mensajes traen una ruta ABSOLUTA embebida (p.ej. TS2305 cita el
  // modulo por su URL completa). Sin normalizarla, la misma firma difiere
  // entre la maquina de quien genera la linea base y el runner de CI, y todo
  // aparece como nuevo y resuelto a la vez. Paso real, no hipotetico.
  const mensajeNormalizado = mensaje
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/file:\/\/\/[^"'`\s]+/g, (u) => rutaRelativa(u));

  const firma = `${ruta} | ${codigo} | ${mensajeNormalizado}`;
  firmas.set(firma, (firmas.get(firma) || 0) + 1);
}

if (total === 0 && !salioLimpio) {
  abortar('deno check fallo pero no se pudo parsear ningun error de su salida.');
}

const serializar = (mapa) =>
  [...mapa.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([f, n]) => `${n}\t${f}`)
    .join('\n');

// ---------- --update ----------
if (actualizar) {
  writeFileSync(BASELINE, `${serializar(firmas)}\n`, 'utf8');
  console.log(`Linea base regenerada: ${BASELINE}`);
  console.log(`  firmas distintas : ${firmas.size}`);
  console.log(`  errores totales  : ${total}`);
  process.exit(0);
}

// ---------- comparar ----------
if (!existsSync(BASELINE)) {
  console.error(`ERROR: no existe la linea base ${BASELINE}.`);
  console.error('Generala con: node scripts/check-edge-types.mjs --update');
  process.exit(2);
}

const base = new Map();
// La linea base se checkoutea con CRLF en Windows y LF en Linux. Cortar solo
// por \n dejaria un \r pegado a cada firma y TODO apareceria como nuevo.
for (const l of readFileSync(BASELINE, 'utf8').split(/\r?\n/)) {
  if (!l.trim()) continue;
  const t = l.indexOf('\t');
  if (t < 0) continue;
  base.set(l.slice(t + 1), Number(l.slice(0, t)));
}

const nuevos = [];
const resueltos = [];
for (const [f, n] of firmas) {
  const previo = base.get(f) || 0;
  if (n > previo) nuevos.push({ firma: f, previo, ahora: n });
}
for (const [f, n] of base) {
  const ahora = firmas.get(f) || 0;
  if (ahora < n) resueltos.push({ firma: f, previo: n, ahora });
}

const totalBase = [...base.values()].reduce((a, b) => a + b, 0);

console.log(`\nType-check de Edge Functions\n${'='.repeat(60)}\n`);
const reportadoPorDeno = contadorFinal ? contadorFinal[1] : String(total);
console.log(`Bloques de error ahora : ${total}   (deno reporta ${reportadoPorDeno})`);
console.log(`Bloques en la base     : ${totalBase}`);
console.log(`Firmas nuevas          : ${nuevos.length}`);
console.log(`Firmas resueltas       : ${resueltos.length}`);

if (resueltos.length) {
  console.log(`\n${'-'.repeat(60)}\nResueltos (gracias):`);
  for (const r of resueltos.slice(0, 20)) {
    console.log(`  ${r.previo} -> ${r.ahora}  ${r.firma}`);
  }
  if (resueltos.length > 20) console.log(`  ... y ${resueltos.length - 20} mas`);
  console.log('\n  Para bajar la linea base: node scripts/check-edge-types.mjs --update');
}

if (nuevos.length) {
  console.log(`\n${'-'.repeat(60)}\nNUEVOS (${nuevos.length}):`);
  for (const n of nuevos) {
    console.log(`  ${n.previo} -> ${n.ahora}  ${n.firma}`);
  }
  console.log(`\n${'='.repeat(60)}`);
  console.log('Hay errores de tipos nuevos en supabase/functions/.\n');
  process.exit(1);
}

console.log(`\n${'='.repeat(60)}`);
console.log('Sin errores de tipos nuevos en supabase/functions/.\n');
process.exit(0);
