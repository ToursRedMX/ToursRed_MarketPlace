/**
 * Prueba de `scripts/check-edge-deps.mjs`.
 *
 * POR QUE EXISTE
 *
 * La guardia nacio el 10-sep-2026 con una sola regla (version exacta) y se
 * comprobo a mano. Al agregarle la segunda (version unica) esa comprobacion
 * manual se repitio, y repetirla a mano una tercera vez es como se pierden las
 * guardias: alguien toca el escaner, la salida sigue siendo verde porque ya no
 * mira nada, y nadie se entera.
 *
 * Lo que se prueba es el COMPORTAMIENTO OBSERVABLE —codigo de salida y texto—,
 * no las funciones internas: es lo unico que CI mira, y deja libre reescribir
 * el escaner por dentro.
 *
 * LOS FIXTURES VAN EN UN DIRECTORIO TEMPORAL, A PROPOSITO
 *
 * Un fixture con `npm:@sentry/deno@9` dentro de `supabase/functions/` haria
 * fallar a la guardia de verdad en cada PR. Se escriben fuera del repo y se le
 * pasan por ruta, que es justo el modo que la guardia ya soportaba.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'guardia-deps-'));
const GUARDIA = 'scripts/check-edge-deps.mjs';

/** Escribe un fixture y devuelve su ruta. */
function fixture(nombre, ...imports) {
  const ruta = join(dir, nombre);
  const cuerpo = imports.map((s, i) => `import x${i} from ${JSON.stringify(s)};`).join('\n');
  writeFileSync(ruta, `${cuerpo}\nexport default 1;\n`);
  return ruta;
}

/** Corre la guardia sobre esas rutas. Devuelve { codigo, salida }. */
function correr(...rutas) {
  try {
    const salida = execFileSync('node', [GUARDIA, ...rutas], { encoding: 'utf8' });
    return { codigo: 0, salida };
  } catch (e) {
    return { codigo: e.status, salida: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

let casos = 0;
function caso(nombre, fn) { fn(); casos++; console.log(`  ok  ${nombre}`); }

console.log('Guardia de dependencias — comportamiento');

// --- Regla 1: version exacta ------------------------------------------------

caso('acepta versiones exactas, subrutas y node:', () => {
  const a = fixture('ok.ts',
    'npm:@supabase/supabase-js@2.116.0',
    'npm:pdfmake@0.2.20/js/printer.js',
    'https://deno.land/std@0.224.0/x/mod.ts',
    'node:buffer',
    './relativo.ts');
  const { codigo, salida } = correr(a);
  assert.equal(codigo, 0, salida);
  assert.match(salida, /Sin hallazgos/);
});

caso('rechaza un rango de mayor', () => {
  const { codigo, salida } = correr(fixture('rango.ts', 'npm:@sentry/deno@9'));
  assert.equal(codigo, 1);
  assert.match(salida, /version no exacta \(9\)/);
});

caso('rechaza un especificador sin version', () => {
  const { codigo, salida } = correr(fixture('sinver.ts', 'jsr:@supabase/functions-js/edge-runtime.d.ts'));
  assert.equal(codigo, 1);
  assert.match(salida, /sin version/);
});

// --- Regla 2: version unica -------------------------------------------------
// Cada caso usa versiones EXACTAS: si la regla 2 no existiera, pasarian todos.

caso('rechaza el mismo paquete en dos versiones', () => {
  const { codigo, salida } = correr(
    fixture('v1.ts', 'npm:@supabase/supabase-js@2.116.0'),
    fixture('v2.ts', 'npm:@supabase/supabase-js@2.39.6'));
  assert.equal(codigo, 1);
  assert.match(salida, /version unica/);
  assert.match(salida, /npm:2\.116\.0/);
  assert.match(salida, /npm:2\.39\.6/);
});

caso('rechaza el mismo paquete y version desde dos registros', () => {
  const { codigo, salida } = correr(
    fixture('r1.ts', 'npm:@supabase/supabase-js@2.116.0'),
    fixture('r2.ts', 'jsr:@supabase/supabase-js@2.116.0'));
  assert.equal(codigo, 1, 'npm y jsr son dos bases de codigo, no una');
  assert.match(salida, /version unica/);
});

caso('la subruta NO cuenta como version distinta', () => {
  const { codigo, salida } = correr(
    fixture('s1.ts', 'npm:pdfmake@0.2.20'),
    fixture('s2.ts', 'npm:pdfmake@0.2.20/js/printer.js'));
  assert.equal(codigo, 0, salida);
});

caso('las dos reglas se reportan juntas, no una u otra', () => {
  const { codigo, salida } = correr(
    fixture('d1.ts', 'npm:@supabase/supabase-js@2.116.0'),
    fixture('d2.ts', 'npm:@supabase/supabase-js@2.39.6'),
    fixture('d3.ts', 'npm:@sentry/deno@9'));
  assert.equal(codigo, 1);
  assert.match(salida, /version unica/, 'falta la regla 2');
  assert.match(salida, /sin version exacta/, 'falta la regla 1');
});

caso('ignora lo que esta en comentarios', () => {
  const ruta = join(dir, 'comentado.ts');
  writeFileSync(ruta,
    '/** Documenta el uso: npm:pdfmake@0.2.x/js/printer.js */\n' +
    '// import viejo from "npm:@supabase/supabase-js@2.39.6";\n' +
    'import ok from "npm:@supabase/supabase-js@2.116.0";\nexport default ok;\n');
  const { codigo, salida } = correr(ruta);
  assert.equal(codigo, 0, salida);
});

// --- El arbol de verdad -----------------------------------------------------

caso('supabase/functions/ cumple las tres reglas hoy', () => {
  const { codigo, salida } = correr();
  assert.equal(codigo, 0, salida);
});

// --- Regla 3: front y edge alineados ----------------------------------------
//
// Esta regla mira package.json y package-lock.json, o sea archivos del repo y no
// fixtures. Para probarla sin tocarlos se copia el arbol minimo a un temporal y
// se corre la guardia ahi con cwd propio.

import { mkdirSync, cpSync } from 'node:fs';
import { execFileSync as ejecutar } from 'node:child_process';

/** Monta un repo de mentira con su package.json, su lock y una edge function. */
function repoDeMentira({ front, lock, edge }) {
  const raiz = mkdtempSync(join(tmpdir(), 'guardia-repo-'));
  mkdirSync(join(raiz, 'scripts'), { recursive: true });
  mkdirSync(join(raiz, 'supabase', 'functions', 'demo'), { recursive: true });
  cpSync(GUARDIA, join(raiz, GUARDIA));
  writeFileSync(join(raiz, 'package.json'),
    JSON.stringify({ name: 'demo', dependencies: { '@supabase/supabase-js': front } }, null, 2));
  if (lock !== null) {
    writeFileSync(join(raiz, 'package-lock.json'), JSON.stringify({
      name: 'demo', lockfileVersion: 3,
      packages: { 'node_modules/@supabase/supabase-js': { version: lock } },
    }, null, 2));
  }
  writeFileSync(join(raiz, 'supabase', 'functions', 'demo', 'index.ts'),
    `import { createClient } from ${JSON.stringify(`npm:@supabase/supabase-js@${edge}`)};
export default createClient;
`);
  return raiz;
}

function correrEn(raiz) {
  try {
    return { codigo: 0, salida: ejecutar('node', [GUARDIA], { cwd: raiz, encoding: 'utf8' }) };
  } catch (e) {
    return { codigo: e.status, salida: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

caso('acepta front y edge en la misma version exacta', () => {
  const { codigo, salida } = correrEn(repoDeMentira({ front: '2.116.0', lock: '2.116.0', edge: '2.116.0' }));
  assert.equal(codigo, 0, salida);
});

caso('rechaza que el front use un rango aunque resuelva a la misma', () => {
  const { codigo, salida } = correrEn(repoDeMentira({ front: '^2.116.0', lock: '2.116.0', edge: '2.116.0' }));
  assert.equal(codigo, 1, 'un caret deja la version a eleccion de npm el dia del install');
  assert.match(salida, /rango/);
});

caso('rechaza front y edge en versiones distintas', () => {
  const { codigo, salida } = correrEn(repoDeMentira({ front: '2.115.0', lock: '2.115.0', edge: '2.116.0' }));
  assert.equal(codigo, 1);
  assert.match(salida, /no coinciden/);
});

// El caso real del 11-sep-2026: package.json correcto, lock atrasado. Netlify
// instala desde el lock, asi que mirar solo package.json lo habria dado por
// bueno mientras produccion corria otra version.
caso('rechaza que el LOCK instale algo distinto de lo declarado', () => {
  const { codigo, salida } = correrEn(repoDeMentira({ front: '2.116.0', lock: '2.115.0', edge: '2.116.0' }));
  assert.equal(codigo, 1, 'el lock es lo que Netlify instala');
  assert.match(salida, /lock/);
});

caso('sin lock, no revienta y sigue comprobando package.json', () => {
  const { codigo, salida } = correrEn(repoDeMentira({ front: '2.116.0', lock: null, edge: '2.116.0' }));
  assert.equal(codigo, 0, salida);
});

rmSync(dir, { recursive: true, force: true });
console.log(`\n${casos} casos, todos ok`);
