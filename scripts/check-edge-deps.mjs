#!/usr/bin/env node
/**
 * Guardia de dependencias de Edge Functions — Req. 6.3.2 de PCI DSS v4.
 *
 * QUE VIGILA
 *
 * Que ningun import remoto de `supabase/functions/` entre al repo sin una
 * version EXACTA. Un `npm:paquete@2` no es una version: es un rango, y Deno lo
 * resuelve al desplegar.
 *
 * POR QUE
 *
 * El Requisito 6.3.2 pide poder responder, ante un aviso de seguridad, cuales
 * componentes de terceros corren y en que version. Con un rango flotante esa
 * pregunta no tiene respuesta: la version la elige el registro el dia del
 * despliegue, y dos funciones desplegadas con semanas de diferencia corren
 * codigo distinto desde el mismo especificador.
 *
 * No es teorico. El 10-sep-2026, antes de esta guardia, el `deno.lock` que
 * generaba CI mostraba esto en 172 funciones:
 *
 *     npm:@sentry/deno@9 ........................ 169 usos -> 9.47.1
 *     jsr:@supabase/functions-js/...d.ts ........ 163 usos -> 2.112.4 (via @*)
 *     npm:@supabase/supabase-js@2 ...............  89 usos -> 2.116.0
 *     jsr:@supabase/supabase-js@2 ...............  13 usos -> 2.114.0
 *
 * O sea que `supabase-js` corria en CUATRO versiones a la vez (2.116.0,
 * 2.114.0, 2.108.2 y 2.39.6), dos de ellas flotantes, y desde DOS registros
 * distintos. El caso peor era `@supabase/functions-js`, importado sin ni un
 * digito de version: Deno lo trataba como `@*`.
 *
 * POR QUE NACE EN CERO Y BLOQUEA
 *
 * Mismo criterio que `guardia-fiscal` y `check-search-path.mjs`: los 434 usos
 * flotantes se fijaron en el mismo PR que trajo esta guardia, asi que arranca
 * en 0 hallazgos. Una guardia que nace con hallazgos se aprende a ignorar, y
 * esa es la peor forma de perderla. Al contrario que `check-edge-types.mjs`,
 * esta no necesita linea base: no habia deuda que tolerar una vez fijados.
 *
 * POR QUE HAY QUE QUITAR COMENTARIOS ANTES DE BUSCAR
 *
 * No es purismo. `_shared/contractDocDefinition.ts` documenta su uso en un
 * bloque `/* *\/` que incluye `npm:pdfmake@0.2.x/js/printer.js`. Un grep
 * ingenuo lo reporta como hallazgo y manda a "arreglar" un ejemplo de la
 * documentacion. Por eso el escaner corre sobre el archivo sin comentarios,
 * respetando comillas y templates para no cortar donde no debe.
 *
 * QUE CUENTA COMO VERSION EXACTA
 *
 *   npm:@sentry/deno@9.47.1 ................... si
 *   npm:pdfmake@0.2.20/js/printer.js .......... si (version exacta + subruta)
 *   jsr:@supabase/supabase-js@2.114.0 ......... si
 *   https://deno.land/std@0.224.0/x/mod.ts .... si
 *   node:buffer ............................... si (built-in, no tiene version)
 *
 *   npm:@supabase/supabase-js@2 ............... NO, rango de mayor
 *   npm:paquete@^1.2.3 / ~1.2.3 / >=1 ......... NO, rango
 *   npm:paquete@0.2.x / @* / @latest .......... NO, comodin
 *   jsr:@supabase/functions-js/edge-runtime... . NO, sin version
 *
 * USO
 *
 *   node scripts/check-edge-deps.mjs             revisa supabase/functions/
 *   node scripts/check-edge-deps.mjs --lista     ademas imprime el inventario
 *   node scripts/check-edge-deps.mjs ruta [...]  revisa solo esos archivos
 *
 * Sale con codigo 1 si encuentra un especificador remoto sin version exacta.
 */

import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const RAIZ = 'supabase/functions';

// ---------------------------------------------------------------------------
// Quitar comentarios sin romper cadenas
// ---------------------------------------------------------------------------
// Se reemplaza cada comentario por espacios (no se borra) para que los offsets
// de caracter sigan valiendo y el numero de linea del hallazgo sea el real.
function sinComentarios(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    // Comentario de linea
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }

    // Comentario de bloque
    if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        // Conservar los saltos de linea: sin ellos se descuadra el conteo.
        if (src[i] !== '\n') out[i] = ' ';
        i++;
      }
      // Cerrar el `*/`
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }

    // Cadenas: se saltan enteras para no confundir un `//` de una URL
    // (`https://...`) con el inicio de un comentario.
    if (c === '"' || c === "'" || c === '`') {
      const cierre = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === cierre) { i++; break; }
        i++;
      }
      continue;
    }

    i++;
  }

  return out.join('');
}

// ---------------------------------------------------------------------------
// Extraer especificadores en posicion de import
// ---------------------------------------------------------------------------
// Solo interesan los que Deno va a resolver de verdad:
//   import ... from "spec"      export ... from "spec"
//   import "spec"               import("spec")
const EN_POSICION_DE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;

const REMOTO = /^(npm:|jsr:|https?:\/\/)/;
const SEMVER_EXACTO = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// npm:/jsr: -> [@scope/]nombre[@version][/subruta]
const PAQUETE = /^(@[^/@]+\/)?([^/@]+)(?:@([^/]+))?(\/.*)?$/;

/**
 * Devuelve null si el especificador esta bien fijado, o el motivo si no.
 */
function motivoDeFallo(spec) {
  // Built-ins de Deno/Node: no tienen version y no hay nada que fijar.
  if (spec.startsWith('node:')) return null;

  if (spec.startsWith('npm:') || spec.startsWith('jsr:')) {
    const resto = spec.slice(4);
    const m = PAQUETE.exec(resto);
    if (!m) return 'no se pudo interpretar el especificador';

    const version = m[3];
    if (version === undefined) return 'sin version';
    if (!SEMVER_EXACTO.test(version)) return `version no exacta (${version})`;
    return null;
  }

  // URL directa: exige un @x.y.z en la ruta, que es como deno.land y esm.sh
  // fijan version.
  const enUrl = /@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\/|$)/.exec(spec);
  if (!enUrl) return 'URL sin version fija';
  return null;
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const quiereLista = argv.includes('--lista');
const rutas = argv.filter((a) => !a.startsWith('--'));

const archivos = (
  rutas.length > 0 ? rutas : globSync(`${RAIZ}/**/*.ts`)
).sort();

if (archivos.length === 0) {
  console.error(`No se encontro ningun .ts bajo ${RAIZ}/`);
  process.exit(2);
}

const hallazgos = [];
const inventario = new Map(); // spec -> cantidad de usos

for (const archivo of archivos) {
  const src = readFileSync(archivo, 'utf8');
  const limpio = sinComentarios(src);

  EN_POSICION_DE_IMPORT.lastIndex = 0;
  let m;
  while ((m = EN_POSICION_DE_IMPORT.exec(limpio)) !== null) {
    const spec = m[2];
    if (!REMOTO.test(spec) && !spec.startsWith('node:')) continue; // relativo

    inventario.set(spec, (inventario.get(spec) ?? 0) + 1);

    const motivo = motivoDeFallo(spec);
    if (motivo === null) continue;

    const linea = limpio.slice(0, m.index).split('\n').length;
    hallazgos.push({ archivo: archivo.replace(/\\/g, '/'), linea, spec, motivo });
  }
}

console.log(`Guardia de dependencias de Edge Functions`);
console.log(`Archivos revisados ...... ${archivos.length}`);
console.log(`Especificadores remotos . ${[...inventario.values()].reduce((a, b) => a + b, 0)} usos, ${inventario.size} distintos`);
console.log('');

if (quiereLista) {
  console.log('Inventario:');
  const orden = [...inventario.entries()].sort((a, b) => b[1] - a[1]);
  for (const [spec, usos] of orden) {
    const marca = motivoDeFallo(spec) === null ? 'ok  ' : 'FLOTA';
    console.log(`  ${marca} ${String(usos).padStart(4)}  ${spec}`);
  }
  console.log('');
}

if (hallazgos.length === 0) {
  console.log('Sin hallazgos: todo import remoto lleva version exacta.');
  process.exit(0);
}

console.log(`Hallazgos: ${hallazgos.length} import(s) sin version exacta.`);
console.log('');

// Agrupados por especificador: es como se arreglan, no archivo por archivo.
const porSpec = new Map();
for (const h of hallazgos) {
  if (!porSpec.has(h.spec)) porSpec.set(h.spec, []);
  porSpec.get(h.spec).push(h);
}

for (const [spec, lista] of [...porSpec.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${spec}`);
  console.log(`    ${lista[0].motivo} — ${lista.length} uso(s)`);
  for (const h of lista.slice(0, 5)) {
    console.log(`      ${h.archivo}:${h.linea}`);
  }
  if (lista.length > 5) console.log(`      ... y ${lista.length - 5} mas`);
  console.log('');
}

console.log('Como se arregla: pon la version exacta a la que ya resuelve hoy.');
console.log('La resolucion actual esta en scripts/edge-check/deno.lock, seccion');
console.log('"specifiers". Fijar a esa version NO cambia el comportamiento: solo');
console.log('deja de depender de que el registro elija por ti al desplegar.');

process.exit(1);
