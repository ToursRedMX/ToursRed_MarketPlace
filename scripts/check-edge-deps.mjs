#!/usr/bin/env node
/**
 * Guardia de dependencias de Edge Functions — Req. 6.3.2 de PCI DSS v4.
 *
 * QUE VIGILA
 *
 * Dos reglas, y conviene no confundirlas:
 *
 *   1. VERSION EXACTA. Que ningun import remoto de `supabase/functions/` entre
 *      al repo sin una version exacta. Un `npm:paquete@2` no es una version: es
 *      un rango, y Deno lo resuelve al desplegar.
 *
 *   2. VERSION UNICA. Que un mismo paquete no corra en dos versiones —ni desde
 *      dos registros— a la vez. La regla 1 sola no lo impide: 175 imports
 *      pueden llevar cada uno su version exacta y distinta, y pasar todos.
 *
 *   3. FRONT Y EDGE ALINEADOS. Que un paquete usado en los dos lados corra la
 *      misma version en `package.json`, en `package-lock.json` y en las Edge
 *      Functions. Las reglas 1 y 2 solo miran `supabase/functions/`, asi que no
 *      ven esta frontera: el 11-sep-2026 el front declaraba `^2.115.0` de
 *      supabase-js y las Edge Functions `2.116.0`, y ningun check chistaba.
 *
 * POR QUE LA REGLA 3 MIRA TAMBIEN EL LOCK
 *
 * Porque es lo que Netlify instala. Ese mismo 11-sep-2026, `package.json` decia
 * `^2.115.0`, el lock decia `2.115.0` y el `node_modules` local tenia 2.116.0:
 * mirar solo lo instalado habria dado "ya estan alineados" cuando produccion
 * corria otra cosa. El lock es la fuente de verdad del build; `node_modules` no.
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
 * Fijar las versiones resolvio lo flotante pero NO la mezcla: quedaron las
 * cuatro, ahora exactas. La mezcla se cerro el 10-sep-2026 en un segundo paso,
 * llevando los 175 usos a `npm:@supabase/supabase-js@2.116.0`. La regla 2 es
 * lo que impide que vuelva.
 *
 * SUBIR DE 2.39.6 A 2.116.0 NO ES UN SALTO DE MAYOR, AUNQUE LO PAREZCA
 *
 * Asusta al mirar los subpaquetes: 2.39.6 trae `postgrest-js@1.9.2` y 2.116.0
 * trae `postgrest-js@2.116.0`. No es una ruptura. Supabase renumero TODOS sus
 * subpaquetes para que coincidan con la version del padre: auth-js,
 * functions-js, postgrest-js, realtime-js y storage-js estan los cinco en
 * 2.116.0. Comprobado ademas sobre la superficie que este repo usa de verdad:
 * de los 27 metodos de `PostgrestFilterBuilder` en 1.9.2, en 2.116.0 no falta
 * NINGUNO, y hay 5 nuevos (`isDistinct`, `notIn`, `regexMatch`,
 * `regexIMatch`, `throwOnError`). Es un superconjunto estricto.
 *
 * POR QUE NACE EN CERO
 *
 * Los 434 usos flotantes se fijaron en el mismo PR que trajo esta guardia, asi
 * que arranca en 0 hallazgos. Una guardia que nace con hallazgos se aprende a
 * ignorar, y esa es la peor forma de perderla. Al contrario que
 * `check-edge-types.mjs`, esta no necesita linea base: no habia deuda que
 * tolerar una vez fijados.
 *
 * NACER EN CERO NO ES LO MISMO QUE BLOQUEAR
 *
 * Nacer en cero es lo que la hace EXIGIBLE; exigirla es un acto aparte, y se
 * hizo el mismo 10-sep-2026: `guardia-dependencias` es check requerido de
 * main, asi que un especificador sin version exacta ya no se puede mergear.
 * Paso de detectar a prevenir.
 *
 * Aun asi, esta linea no es la fuente de verdad. Los checks requeridos se leen
 * en la API, nunca de un comentario ni de un documento:
 *
 *     gh api repos/ToursRedMX/ToursRed_MarketPlace/branches/main/protection \
 *       --jq '.required_status_checks.contexts'
 *
 * El 10-sep-2026 eran ocho, esta incluida.
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
 * QUE INCUMPLE LA REGLA 2, aunque cada linea sea exacta
 *
 *   npm:@supabase/supabase-js@2.116.0  en una funcion
 *   npm:@supabase/supabase-js@2.39.6   en otra ...... NO, dos versiones
 *   jsr:@supabase/supabase-js@2.116.0  en otra ...... NO, dos registros
 *
 * La subruta no cuenta como diferencia: `npm:pdfmake@0.2.20` y
 * `npm:pdfmake@0.2.20/js/printer.js` son el mismo paquete en la misma version,
 * y asi los agrupa la guardia.
 *
 * LA UNICA EXCEPCION DE LA REGLA 3, Y POR QUE ES DEFINITIVA
 *
 * `xlsx` corre 0.20.3 en el front y 0.18.5 en las Edge Functions, y **no se
 * puede alinear cambiando un numero**: SheetJS dejo de publicar en npm, donde
 * la ultima es 0.18.5 (2022). La 0.20.3 solo existe en su CDN — `npm view
 * xlsx@0.20.3` responde 404. Alinearlos exigia cambiar de ORIGEN —o las Edge
 * Functions tiran del CDN de SheetJS, o el front vuelve a una version de 2022—
 * y el 11-sep-2026 Axel decidio que ninguna de las dos: cada lado se queda con
 * la ultima version que su origen ofrece. La exclusion no es provisional.
 *
 * Lo que conviene saber al tomarla: 0.18.5 esta por debajo de DOS avisos
 * "high" —GHSA-4r6h-8v6p-xvw6 (prototype pollution, < 0.19.3) y
 * GHSA-5pgg-2g8v-p4x9 (ReDoS, < 0.20.2)—, **ninguno con parche en npm**. La
 * exposicion practica hoy es nula: los dos se disparan al PARSEAR un archivo, y
 * medido el 11-sep-2026 **nadie en el repo llama a `XLSX.read`** — front y edge
 * solo GENERAN hojas (`aoa_to_sheet`, `book_new`, `write`). O sea: version
 * vulnerable, camino vulnerable no ejercitado. Si algun dia alguien acepta un
 * .xlsx subido por un usuario, esto deja de ser deuda y pasa a ser urgente.
 *
 * USO
 *
 *   node scripts/check-edge-deps.mjs             revisa supabase/functions/
 *   node scripts/check-edge-deps.mjs --lista     ademas imprime el inventario
 *   node scripts/check-edge-deps.mjs ruta [...]  revisa solo esos archivos
 *
 * Sale con codigo 1 si encuentra un especificador remoto sin version exacta
 * (regla 1) o un paquete usado en mas de una version o registro (regla 2).
 */

import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

const RAIZ = 'supabase/functions';

// Barra invertida de Windows. Se arma por codigo para no pelearse con el
// escapado al generar este archivo desde un script.
const SEPARADOR = String.fromCharCode(92);

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
 * Parte un especificador npm:/jsr: en sus piezas. Devuelve null para lo que no
 * es un paquete versionado (relativos, node:, URLs sueltas).
 *
 * La SUBRUTA se descarta a proposito: `npm:pdfmake@0.2.20` y
 * `npm:pdfmake@0.2.20/js/printer.js` son el mismo paquete en la misma version,
 * y contarlos como dos versiones distintas seria un falso positivo garantizado.
 */
function partes(spec) {
  if (!spec.startsWith('npm:') && !spec.startsWith('jsr:')) return null;
  const m = PAQUETE.exec(spec.slice(4));
  if (!m) return null;
  return {
    registro: spec.slice(0, 3),
    paquete: (m[1] ?? '') + m[2],
    version: m[3] ?? '(sin version)',
  };
}

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
// paquete -> Map("npm:2.116.0" -> [archivos]). Alimenta la regla 2.
const versionesPorPaquete = new Map();

for (const archivo of archivos) {
  const src = readFileSync(archivo, 'utf8');
  const limpio = sinComentarios(src);

  EN_POSICION_DE_IMPORT.lastIndex = 0;
  let m;
  while ((m = EN_POSICION_DE_IMPORT.exec(limpio)) !== null) {
    const spec = m[2];
    if (!REMOTO.test(spec) && !spec.startsWith('node:')) continue; // relativo

    inventario.set(spec, (inventario.get(spec) ?? 0) + 1);

    const p = partes(spec);
    if (p !== null) {
      if (!versionesPorPaquete.has(p.paquete)) versionesPorPaquete.set(p.paquete, new Map());
      const porVersion = versionesPorPaquete.get(p.paquete);
      const clave = `${p.registro}:${p.version}`;
      if (!porVersion.has(clave)) porVersion.set(clave, []);
      porVersion.get(clave).push(archivo.split(SEPARADOR).join('/'));
    }

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

// --- Regla 3: front y edge, la misma version --------------------------------
// Solo tiene sentido sobre el arbol completo: con rutas sueltas (los fixtures de
// la prueba) no hay "las Edge Functions" que comparar contra el front.
//
// `xlsx` queda fuera a proposito. No es pereza: SheetJS dejo de publicar en npm
// y la 0.20.3 del front solo existe en su CDN, asi que alinearlo no es cambiar
// un numero. La razon larga esta en el encabezado de este archivo.
const FUERA_DE_LA_REGLA_3 = new Set(['xlsx']);

const desalineados = [];

if (rutas.length === 0) {
  let pj = null;
  let lock = null;
  try { pj = JSON.parse(readFileSync('package.json', 'utf8')); } catch { /* sin front que comparar */ }
  try { lock = JSON.parse(readFileSync('package-lock.json', 'utf8')); } catch { /* sin lock */ }

  if (pj !== null) {
    const declaradoEnFront = new Map();
    for (const seccion of ['dependencies', 'devDependencies']) {
      for (const [nombre, rango] of Object.entries(pj[seccion] ?? {})) declaradoEnFront.set(nombre, rango);
    }

    for (const [paquete, porVersion] of versionesPorPaquete) {
      if (FUERA_DE_LA_REGLA_3.has(paquete)) continue;
      if (!declaradoEnFront.has(paquete)) continue;      // solo vive en edge
      if (porVersion.size !== 1) continue;                // ya lo reporta la regla 2

      const versionEdge = [...porVersion.keys()][0].split(':')[1];
      const rangoFront = declaradoEnFront.get(paquete);

      // Un rango en el front hace la pregunta irrespondible: la version la
      // elige npm el dia del install, que es el problema de la regla 1 al otro
      // lado de la frontera. Se reutiliza SEMVER_EXACTO en vez de escribir otra
      // expresion para rangos: un `^`, un `~` o un `x` simplemente NO son un
      // semver exacto, y esa comprobacion ya esta probada por la regla 1.
      if (!SEMVER_EXACTO.test(rangoFront)) {
        desalineados.push({ paquete, motivo: `el front declara un rango (${rangoFront}) en vez de una version exacta`, front: rangoFront, edge: versionEdge });
        continue;
      }
      if (rangoFront !== versionEdge) {
        desalineados.push({ paquete, motivo: 'el front y las Edge Functions no coinciden', front: rangoFront, edge: versionEdge });
        continue;
      }
      // package.json puede decir lo correcto y el lock instalar otra cosa. Es lo
      // que Netlify usa de verdad, asi que se comprueba aparte.
      const enLock = lock?.packages?.[`node_modules/${paquete}`]?.version;
      if (enLock !== undefined && enLock !== versionEdge) {
        desalineados.push({ paquete, motivo: 'el lock instala una version distinta de la que declara package.json', front: `${rangoFront} (lock: ${enLock})`, edge: versionEdge });
      }
    }
  }
}

if (desalineados.length > 0) {
  console.log(`Regla 3 — front y edge alineados: ${desalineados.length} paquete(s) desalineado(s).`);
  console.log('');
  for (const d of desalineados) {
    console.log(`  ${d.paquete}`);
    console.log(`    ${d.motivo}`);
    console.log(`    front: ${d.front}`);
    console.log(`    edge : ${d.edge}`);
    console.log('');
  }
  console.log('Como se arregla: pon la MISMA version exacta en package.json y en los');
  console.log('imports de supabase/functions/, y actualiza el lock con');
  console.log('  npm install --package-lock-only');
  console.log('que lo reescribe sin descargar nada.');
  console.log('');
}

// --- Regla 2: un paquete, una version ---------------------------------------
const conflictos = [...versionesPorPaquete.entries()]
  .filter(([, porVersion]) => porVersion.size > 1)
  .sort((a, b) => b[1].size - a[1].size);

if (conflictos.length > 0) {
  console.log(`Regla 2 — version unica: ${conflictos.length} paquete(s) en mas de una version.`);
  console.log('');
  for (const [paquete, porVersion] of conflictos) {
    console.log(`  ${paquete}`);
    const orden = [...porVersion.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [clave, archivosDeEsa] of orden) {
      console.log(`    ${clave.padEnd(20)} ${String(archivosDeEsa.length).padStart(4)} uso(s)`);
      for (const a of archivosDeEsa.slice(0, 3)) console.log(`        ${a}`);
      if (archivosDeEsa.length > 3) console.log(`        ... y ${archivosDeEsa.length - 3} mas`);
    }
    console.log('');
  }
  console.log('Como se arregla: deja UNA sola version, normalmente la mas alta que');
  console.log('ya este en uso. No basta con que cada linea sea exacta: dos versiones');
  console.log('del mismo paquete son dos bases de codigo distintas corriendo a la vez,');
  console.log('y ante un aviso de seguridad hay que parchear las dos.');
  console.log('');
}

if (hallazgos.length === 0 && conflictos.length === 0 && desalineados.length === 0) {
  console.log('Sin hallazgos: todo import remoto lleva version exacta,');
  console.log(`los ${versionesPorPaquete.size} paquetes corren en una sola version cada uno,`);
  console.log('y los compartidos con el front coinciden con el.');
  process.exit(0);
}

if (hallazgos.length === 0) process.exit(1);

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
