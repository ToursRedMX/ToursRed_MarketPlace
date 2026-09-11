#!/usr/bin/env node
/**
 * Guardia de SUBRUTAS de imports remotos en Edge Functions.
 *
 * QUE VIGILA
 *
 * Que cuando un import apunta a un archivo DENTRO de un paquete
 * —`npm:pdfmake@0.2.20/js/printer.js`— ese archivo exista de verdad.
 *
 * POR QUE HACE FALTA UNA GUARDIA APARTE
 *
 * Porque nada mas lo ve, y esta comprobado uno por uno el 11-sep-2026:
 *
 *   node scripts/check-edge-deps.mjs ... la version es exacta y unica: PASA
 *   deno check .................... exit 0: PASA
 *   deno check --all .............. exit 0: PASA
 *   deno cache .................... exit 0: PASA, y ademas descarga el paquete
 *   deno run ...................... FALLA, pero ejecuta la funcion entera
 *
 * O sea que el unico que lo detecta es el que no se puede usar en CI sobre una
 * funcion de produccion.
 *
 * EL CASO QUE LA MOTIVA
 *
 * `generate-signed-contract` importaba `npm:pdfmake@0.2.20/js/printer.js`. Esa
 * carpeta NO EXISTE en el paquete: 0.2.20 trae `build/` y `src/`. La funcion
 * llevaba semanas asi en el repo y nadie lo noto, porque seguia sirviendo una
 * compilacion anterior al cambio; al redesplegarla el 11-sep-2026 murio con
 * `worker boot error: ... path not found`. El CLI, mientras tanto, respondio
 * "Deployed Functions".
 *
 * COMO LO COMPRUEBA SIN EJECUTAR NADA
 *
 * `import.meta.resolve(spec)` devuelve la ruta a la que el runtime resolveria
 * el import, SIN importar el modulo — asi no se ejecuta codigo de terceros, que
 * es lo que descarta usar `deno run`. Si esa ruta es un `file://`, basta con
 * mirar si existe.
 *
 * El paquete tiene que estar descargado para que la ruta signifique algo, y de
 * eso se encarga un `deno cache` previo: no falla ante la subruta mala (ya se
 * probo) pero si baja el paquete.
 *
 * USO
 *
 *   node scripts/check-edge-subpaths.mjs          revisa supabase/functions/
 *   node scripts/check-edge-subpaths.mjs ruta...  revisa solo esos archivos
 *
 * Sale con 1 si alguna subruta no existe, y con 2 si no se pudo comprobar.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, globSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RAIZ = 'supabase/functions';
const DENO = process.env.DENO_BIN || 'deno';

// Mismo escaner que `check-edge-deps.mjs`: hay que quitar comentarios antes de
// buscar, porque `_shared/contractDocDefinition.ts` documenta su uso con un
// `npm:pdfmake@0.2.x/js/printer.js` de ejemplo dentro de un bloque /* */.
function sinComentarios(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out[i] = ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') out[i] = ' '; i++; }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const cierre = c; i++;
      while (i < n) { if (src.charCodeAt(i) === 92) { i += 2; continue; } if (src[i] === cierre) { i++; break; } i++; }
      continue;
    }
    i++;
  }
  return out.join('');
}

const EN_POSICION_DE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/g;
// npm:/jsr: -> [@scope/]nombre[@version][/subruta]
const PAQUETE = /^(@[^/@]+\/)?([^/@]+)(?:@([^/]+))?(\/.*)?$/;

const argv = process.argv.slice(2);
const rutas = argv.filter((a) => !a.startsWith('--'));
const archivos = (rutas.length > 0 ? rutas : globSync(`${RAIZ}/**/*.ts`)).sort();

if (archivos.length === 0) {
  console.error(`No se encontro ningun .ts bajo ${RAIZ}/`);
  process.exit(2);
}

// spec -> [{archivo, linea}]
const conSubruta = new Map();

for (const archivo of archivos) {
  const limpio = sinComentarios(readFileSync(archivo, 'utf8'));
  EN_POSICION_DE_IMPORT.lastIndex = 0;
  let m;
  while ((m = EN_POSICION_DE_IMPORT.exec(limpio)) !== null) {
    const spec = m[2];
    if (!spec.startsWith('npm:') && !spec.startsWith('jsr:')) continue;
    const p = PAQUETE.exec(spec.slice(4));
    if (!p || !p[4]) continue;              // sin subruta: no es cosa de esta guardia
    const linea = limpio.slice(0, m.index).split('\n').length;
    if (!conSubruta.has(spec)) conSubruta.set(spec, []);
    conSubruta.get(spec).push({ archivo: archivo.split(String.fromCharCode(92)).join('/'), linea });
  }
}

console.log('Guardia de subrutas de imports remotos');
console.log(`Archivos revisados ...... ${archivos.length}`);
console.log(`Imports con subruta ..... ${[...conSubruta.values()].reduce((a, b) => a + b.length, 0)} usos, ${conSubruta.size} distintos`);
console.log('');

if (conSubruta.size === 0) {
  console.log('No hay ningun import con subruta. Nada que comprobar.');
  process.exit(0);
}

const abortar = (motivo, detalle) => {
  console.error(`ERROR: ${motivo}`);
  console.error('No se puede concluir nada, y esto NO es "sin hallazgos".');
  if (detalle) console.error(detalle.trim().split('\n').slice(-12).join('\n'));
  process.exit(2);
};

const dir = mkdtempSync(join(tmpdir(), 'subrutas-'));
const malos = [];

try {
  const specs = [...conSubruta.keys()];
  const deJsr = specs.filter((s) => s.startsWith('jsr:'));
  const deNpm = specs.filter((s) => s.startsWith('npm:'));

  // ---- jsr: basta `deno cache`, que SI falla ante una subruta inexistente ----
  for (const spec of deJsr) {
    const f = join(dir, `jsr-${deJsr.indexOf(spec)}.ts`);
    writeFileSync(f, `import ${JSON.stringify(spec)};\n`);
    const r = spawnSync(DENO, ['cache', f], { encoding: 'utf8' });
    if (r.error) abortar(`no se pudo ejecutar "${DENO}": ${r.error.message}`);
    if (r.status !== 0) {
      const salida = `${r.stdout || ''}${r.stderr || ''}`;
      malos.push({ spec, motivo: 'el registro no sirve esa subruta', extra: salida.trim().split('\n').slice(0, 6).join('\n      ') });
    } else {
      console.log(`  ok    ${spec}`);
    }
  }

  // ---- npm: `deno cache` NO falla, hay que mirar el archivo en el cache ----
  if (deNpm.length > 0) {
    const sonda = join(dir, 'npm.ts');
    writeFileSync(sonda, deNpm.map((s) => `import ${JSON.stringify(s)};`).join('\n') + '\n');
    const bajar = spawnSync(DENO, ['cache', sonda], { encoding: 'utf8' });
    if (bajar.error) abortar(`no se pudo ejecutar "${DENO}": ${bajar.error.message}`);

    const info = spawnSync(DENO, ['info', '--json'], { encoding: 'utf8' });
    if (info.status !== 0) abortar('no se pudo leer la ruta del cache de npm', `${info.stdout || ''}${info.stderr || ''}`);
    let npmCache;
    try { npmCache = JSON.parse(info.stdout).npmCache; } catch { npmCache = undefined; }
    if (!npmCache) abortar('`deno info --json` no devolvio npmCache.', info.stdout);

    for (const spec of deNpm) {
      const m = PAQUETE.exec(spec.slice(4));
      const nombre = (m[1] ?? '') + m[2];
      const version = m[3];
      const subruta = m[4].replace(/^\//, '');
      const raizPaquete = join(npmCache, 'registry.npmjs.org', ...nombre.split('/'), version);

      if (!existsSync(raizPaquete)) {
        abortar(`el paquete ${nombre}@${version} no esta en el cache tras "deno cache".`,
          `Se buscaba en ${raizPaquete}`);
      }
      if (existsSync(join(raizPaquete, subruta))) {
        console.log(`  ok    ${spec}`);
      } else {
        // Ayuda a quien lo arregle: que hay de verdad en la raiz del paquete.
        let dentro = '';
        try {
          dentro = readdirSync(raizPaquete).filter((x) => !x.startsWith('.')).slice(0, 12).join(', ');
        } catch { /* da igual */ }
        malos.push({ spec, motivo: `el paquete no contiene "${subruta}"`, extra: `en la raiz hay: ${dentro}` });
      }
    }
  }

  if (malos.length === 0) {
    console.log('');
    console.log('Todas las subrutas existen.');
    process.exit(0);
  }

  console.log('');
  console.log(`Hallazgos: ${malos.length} subruta(s) que no existen.`);
  console.log('');
  for (const r of malos) {
    console.log(`  ${r.spec}`);
    console.log(`    ${r.motivo}`);
    if (r.extra) console.log(`      ${r.extra}`);
    for (const u of conSubruta.get(r.spec).slice(0, 5)) console.log(`      ${u.archivo}:${u.linea}`);
    console.log('');
  }
  console.log('Esto NO lo caza ningun otro check: la guardia de dependencias ve la');
  console.log('version exacta y unica, `deno check` sale con 0, y `deno cache`');
  console.log('tambien con 0 cuando es npm. Solo revienta al ARRANCAR la funcion,');
  console.log('o sea en produccion, despues de que el CLI diga "Deployed Functions".');
  console.log('');
  console.log('Como se arregla: mira que trae el paquete de verdad. Casi siempre basta');
  console.log('con importarlo sin subruta y usar su export por defecto.');
  process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
