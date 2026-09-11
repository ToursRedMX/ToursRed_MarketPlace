/**
 * Prueba de `scripts/check-edge-subpaths.mjs`.
 *
 * EL PRIMER CASO ES EL QUE IMPORTA: ES EL FALLO REAL
 *
 * `npm:pdfmake@0.2.20/js/printer.js` es, literalmente, el import que tumbo
 * `generate-signed-contract` en produccion el 11-sep-2026. Si algun dia la
 * guardia deja de cazarlo, esta prueba se pone roja.
 *
 * Los dos mecanismos se prueban por separado a proposito, porque son DISTINTOS
 * y se descubrio a base de probar:
 *
 *   jsr: `deno cache` SI falla ante una subruta inexistente.
 *   npm: `deno cache` sale con 0 igualmente, asi que hay que mirar el archivo
 *        dentro del paquete descargado.
 *
 * Un solo mecanismo habria dejado medio hueco abierto sin que se notara.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const GUARDIA = resolve('scripts/check-edge-subpaths.mjs');
const dir = mkdtempSync(join(tmpdir(), 'prueba-subrutas-'));

function fixture(nombre, spec) {
  const ruta = join(dir, nombre);
  writeFileSync(ruta, `import x from ${JSON.stringify(spec)};\nexport default x;\n`);
  return ruta;
}

function correr(...rutas) {
  try {
    return { codigo: 0, salida: execFileSync('node', [GUARDIA, ...rutas], { encoding: 'utf8' }) };
  } catch (e) {
    return { codigo: e.status, salida: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

let casos = 0;
const caso = (nombre, fn) => { fn(); casos++; console.log(`  ok  ${nombre}`); };

console.log('Guardia de subrutas — comportamiento');

caso('caza el import que tumbo generate-signed-contract', () => {
  const { codigo, salida } = correr(fixture('real.ts', 'npm:pdfmake@0.2.20/js/printer.js'));
  assert.equal(codigo, 1, 'este es el fallo real de produccion: tiene que verse');
  assert.match(salida, /no contiene "js\/printer\.js"/);
  // El mensaje debe decir que SI hay en el paquete: sin eso, quien lo lea no
  // sabe por donde empezar.
  assert.match(salida, /en la raiz hay:.*build/);
});

caso('acepta una subruta npm que si existe', () => {
  const { codigo, salida } = correr(fixture('bueno.ts', 'npm:pdfmake@0.2.20/build/pdfmake.js'));
  assert.equal(codigo, 0, salida);
  assert.match(salida, /Todas las subrutas existen/);
});

caso('caza una subruta jsr inexistente (otro mecanismo)', () => {
  const { codigo, salida } = correr(fixture('jsrmalo.ts', 'jsr:@supabase/functions-js@2.112.4/no-existe.d.ts'));
  assert.equal(codigo, 1);
  assert.match(salida, /el registro no sirve esa subruta/);
});

caso('acepta la subruta jsr que usa el repo', () => {
  const { codigo, salida } = correr(fixture('jsrbueno.ts', 'jsr:@supabase/functions-js@2.112.4/edge-runtime.d.ts'));
  assert.equal(codigo, 0, salida);
});

caso('ignora lo que esta en comentarios', () => {
  const ruta = join(dir, 'comentado.ts');
  writeFileSync(ruta,
    '/** Ejemplo de uso: npm:pdfmake@0.2.x/js/printer.js */\n' +
    '// import viejo from "npm:pdfmake@0.2.20/js/printer.js";\n' +
    'export default 1;\n');
  const { codigo, salida } = correr(ruta);
  assert.equal(codigo, 0, salida);
  assert.match(salida, /No hay ningun import con subruta/);
});

caso('un import SIN subruta no es cosa de esta guardia', () => {
  const { codigo, salida } = correr(fixture('sinsub.ts', 'npm:pdfmake@0.2.20'));
  assert.equal(codigo, 0, salida);
  assert.match(salida, /No hay ningun import con subruta/);
});

caso('supabase/functions/ esta limpio hoy', () => {
  const { codigo, salida } = correr();
  assert.equal(codigo, 0, salida);
});

rmSync(dir, { recursive: true, force: true });
console.log(`\n${casos} casos, todos ok`);
