#!/usr/bin/env node
/**
 * Type-check del front con linea base, hermano de `check-edge-types.mjs`.
 *
 * POR QUE EXISTE, SI YA HABIA UN CONTADOR
 *
 * `typecheck.yml` llevaba desde el 26-ago-2026 una linea base por CONTADOR
 * (`BASELINE_TOTAL`), y un contador no sirve para esto por dos razones que se
 * vieron las dos:
 *
 *   1. No detecta sustituciones. Arreglas cinco errores y metes cinco: el total
 *      no se mueve y los cinco nuevos entran sin que nada avise.
 *   2. Se desactualiza en silencio. El 11-sep-2026 la base decia 460 y el repo
 *      estaba en 428: habia 32 de holgura, o sea que cabian 32 errores nuevos
 *      sin disparar el aviso. Nadie lo noto porque el aviso no salta hasta
 *      pasarse, y bajar errores no obliga a tocar el numero.
 *
 * Comparar por FIRMA arregla las dos: un error nuevo es una firma que no estaba,
 * aunque el total baje.
 *
 * POR QUE LA FIRMA NO LLEVA LINEA NI COLUMNA
 *
 * Porque si las llevara, meter una linea en blanco arriba convertiria los
 * errores de ese archivo en "nuevos". No es teorico: el 11-sep-2026, al añadir
 * campos a `src/types/index.ts`, una comparacion con numero de linea dio 10
 * falsos nuevos que solo se habian desplazado. La misma leccion que ya estaba
 * escrita en `check-edge-types.mjs`.
 *
 * ESTO NO NACE EN CERO, Y ESTA BIEN
 *
 * Al contrario que las guardias de dependencias, aqui la linea base arranca con
 * 174 errores. Exigir cero pedia semanas de limpieza antes de tener ninguna red;
 * la base da la red desde el primer dia y deja bajar el numero cuando se pueda.
 * Lo que NO se tolera es que suba.
 *
 * USO
 *
 *   node scripts/check-front-types.mjs            compara contra la linea base
 *   node scripts/check-front-types.mjs --update   regenera la linea base
 *
 * Sale con 1 si hay errores nuevos, y con 2 si no se pudo concluir nada.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// Las tres rutas admiten override por entorno. No es configurabilidad por
// gusto: es lo que permite que `test-guardia-tipos-front.mjs` monte un
// proyecto de mentira y compruebe que la guardia muerde, sin tocar el repo.
const BASELINE = process.env.FRONT_BASELINE || 'scripts/front-check/baseline.txt';
const PROYECTO = process.env.FRONT_TSCONFIG || 'tsconfig.app.json';

const actualizar = process.argv.includes('--update');

// ---------- correr tsc ----------
// Se invoca el binario de TypeScript con node, no `npx`: en Windows `npx.cmd`
// necesita `shell: true` (da EINVAL sin el), y abrir una shell para esto solo
// añade una capa de escapado que puede morder. Asi es la misma llamada en los
// tres sistemas y no depende de que `npx` resuelva nada.
const TSC = process.env.FRONT_TSC || 'node_modules/typescript/bin/tsc';

if (!existsSync(TSC)) {
  console.error(`ERROR: no se encontro ${TSC}. Falta correr npm ci?`);
  process.exit(2);
}

const res = spawnSync(
  process.execPath,
  [TSC, '--noEmit', '-p', PROYECTO],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

const salida = `${res.stdout || ''}${res.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '');

// ---------- distinguir "sin errores" de "no corrio" ----------
// Es la razon de ser de este bloque, y viene de un susto real en el guard de
// edge: un 403 del registro hizo que el chequeo muriera sin comprobar nada y el
// script dijera "sin errores nuevos". Un check que no corre NO es un check
// verde. El codigo de salida es la unica evidencia positiva:
//   0     -> corrio y no encontro nada
//   != 0  -> corrio y encontro errores, O fallo por otra causa
// Para el segundo caso se exige ademas ver errores de tipos de verdad.
const RE_ERROR = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
// Se corta por /\r?\n/ y no por un salto pelado. En Windows tsc emite CRLF, y en
// JavaScript el punto NO casa \r, asi que el (.*)$ del patron falla en la
// ultima captura y NINGUNA linea coincide. El sintoma es peor que el fallo:
// el script creeria que tsc no reporto ni un error de tipos.
const lineasDeSalida = salida.split(/\r?\n/);
const hayErroresDeTipos = lineasDeSalida.some((l) => RE_ERROR.test(l));
const salioLimpio = res.status === 0;

const abortar = (motivo) => {
  console.error(`ERROR: ${motivo}`);
  console.error('No se puede concluir nada, y esto NO es "sin errores nuevos".');
  console.error('--- ultimas lineas de la salida de tsc ---');
  console.error(salida.trim().split('\n').slice(-15).join('\n') || '(sin salida)');
  process.exit(2);
};

if (res.error) abortar(`no se pudo ejecutar tsc: ${res.error.message}`);
if (res.status === null) abortar(`tsc murio por señal (${res.signal ?? 'desconocida'}).`);
if (!salioLimpio && !hayErroresDeTipos) {
  abortar(`tsc fallo (codigo ${res.status}) sin reportar ni un error de tipos.`);
}
if (salioLimpio && hayErroresDeTipos) {
  abortar('tsc salio con codigo 0 pero reporto errores de tipos.');
}

// ---------- parsear a firmas ----------
// Solo cuentan las lineas que empiezan en la columna 0 con el patron completo:
// tsc parte los mensajes largos en lineas de continuacion INDENTADAS que
// tambien traen parentesis y numeros, y contarlas inflaria el total.
const BARRA_INVERTIDA = String.fromCharCode(92);

// La raiz del repo, con barras normales. Se recorta de cualquier ruta para que
// la firma sea la misma en Windows y en el runner de Linux: sin esto, un
// mensaje que cite una ruta absoluta produce firmas distintas en cada maquina
// y TODO sale como nuevo y resuelto a la vez. Le paso a la guardia de edge.
const RAIZ = process.cwd().split(BARRA_INVERTIDA).join('/');

function normalizarRuta(p) {
  let r = p.split(BARRA_INVERTIDA).join('/');
  if (r.startsWith(RAIZ + '/')) r = r.slice(RAIZ.length + 1);
  return r;
}

const firmas = new Map();
let total = 0;

for (const linea of lineasDeSalida) {
  const m = linea.match(RE_ERROR);
  if (!m) continue;
  total++;
  const [, ruta, , , codigo, mensaje] = m;

  // El mensaje puede citar rutas absolutas (modulos, sobre todo). Sin
  // normalizarlas, la misma firma difiere entre la maquina de quien genera la
  // base y el runner de CI, y todo sale como nuevo y resuelto a la vez.
  const mensajeNormalizado = normalizarRuta(mensaje)
    .trim()
    .replace(/\s+/g, ' ')
    .split(RAIZ + '/').join('');

  const firma = `${normalizarRuta(ruta)} | ${codigo} | ${mensajeNormalizado}`;
  firmas.set(firma, (firmas.get(firma) || 0) + 1);
}

if (total === 0 && !salioLimpio) {
  abortar('tsc fallo pero no se pudo parsear ningun error de su salida.');
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
  console.error('Generala con: node scripts/check-front-types.mjs --update');
  process.exit(2);
}

const base = new Map();
// La base se checkoutea con CRLF en Windows y LF en Linux. Cortar solo por \n
// dejaria un \r pegado a cada firma y TODO apareceria como nuevo.
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

console.log(`\nType-check del front (${PROYECTO})\n${'='.repeat(60)}\n`);
console.log(`Errores ahora     : ${total}`);
console.log(`Errores en la base: ${totalBase}`);
console.log(`Firmas nuevas     : ${nuevos.length}`);
console.log(`Firmas resueltas  : ${resueltos.length}`);

if (resueltos.length) {
  console.log(`\n${'-'.repeat(60)}\nResueltos (gracias):`);
  for (const r of resueltos.slice(0, 15)) {
    console.log(`  ${r.previo} -> ${r.ahora}  ${r.firma.slice(0, 110)}`);
  }
  if (resueltos.length > 15) console.log(`  ... y ${resueltos.length - 15} mas`);
  console.log('\n  Para bajar la linea base: node scripts/check-front-types.mjs --update');
}

if (nuevos.length) {
  console.log(`\n${'-'.repeat(60)}\nNUEVOS (${nuevos.length}):`);
  for (const n of nuevos) {
    console.log(`  ${n.previo} -> ${n.ahora}  ${n.firma}`);
  }
  console.log(`\n${'='.repeat(60)}`);
  console.log('Hay errores de tipos NUEVOS en el front.');
  console.log('Si el cambio es legitimo y bajan otros, regenera la base con --update.\n');
  process.exit(1);
}

console.log(`\n${'='.repeat(60)}`);
console.log('Sin errores de tipos nuevos en el front.\n');
process.exit(0);
