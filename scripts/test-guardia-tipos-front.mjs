/**
 * Prueba de `scripts/check-front-types.mjs`.
 *
 * EL CASO QUE JUSTIFICA TODO ESTO ES EL DE LA SUSTITUCION
 *
 * Lo que reemplaza esta guardia era un contador (`BASELINE_TOTAL` en
 * `typecheck.yml`). Un contador da verde cuando se arregla un error y se mete
 * otro, porque el total no se mueve. El cuarto caso de aqui hace exactamente
 * eso y exige que la guardia lo cace; si alguien vuelve a comparar por totales,
 * esa prueba se pone roja.
 *
 * El proyecto de mentira vive en un temporal FUERA del repo, y por eso la
 * guardia admite `FRONT_TSCONFIG`, `FRONT_BASELINE` y `FRONT_TSC`: sin ellos
 * habria que escribir archivos con errores dentro de `src/`, que es justo lo
 * que la guardia de verdad tiene que ver rojo en cada PR.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const GUARDIA = resolve('scripts/check-front-types.mjs');
const TSC = resolve('node_modules/typescript/bin/tsc');
const raiz = mkdtempSync(join(tmpdir(), 'guardia-tipos-'));
mkdirSync(join(raiz, 'src'), { recursive: true });

const TSCONFIG = join(raiz, 'tsconfig.prueba.json');
writeFileSync(TSCONFIG, JSON.stringify({
  compilerOptions: {
    target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler',
    strict: true, noEmit: true, noUnusedLocals: true, skipLibCheck: true,
  },
  include: ['src'],
}, null, 2));

const BASELINE = join(raiz, 'baseline.txt');

/** Escribe los archivos de `src/` del proyecto de mentira. */
function fuentes(archivos) {
  rmSync(join(raiz, 'src'), { recursive: true, force: true });
  mkdirSync(join(raiz, 'src'), { recursive: true });
  for (const [nombre, texto] of Object.entries(archivos)) {
    writeFileSync(join(raiz, 'src', nombre), texto);
  }
}

function correr(args = []) {
  const opciones = {
    cwd: raiz, encoding: 'utf8',
    env: { ...process.env, FRONT_TSCONFIG: TSCONFIG, FRONT_BASELINE: BASELINE, FRONT_TSC: TSC },
  };
  try {
    return { codigo: 0, salida: execFileSync('node', [GUARDIA, ...args], opciones) };
  } catch (e) {
    return { codigo: e.status, salida: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

let casos = 0;
const caso = (nombre, fn) => { fn(); casos++; console.log(`  ok  ${nombre}`); };

console.log('Guardia de tipos del front — comportamiento');

const CON_ERROR_A = 'export const a: number = "no soy numero";\n';
const CON_ERROR_B = 'export const b: boolean = 42;\n';
const LIMPIO = 'export const c = 1;\n';

caso('genera la linea base y despues pasa contra ella', () => {
  fuentes({ 'uno.ts': CON_ERROR_A, 'dos.ts': LIMPIO });
  const gen = correr(['--update']);
  assert.equal(gen.codigo, 0, gen.salida);
  assert.match(gen.salida, /errores totales\s*:\s*1/);

  const cmp = correr();
  assert.equal(cmp.codigo, 0, cmp.salida);
  assert.match(cmp.salida, /Sin errores de tipos nuevos/);
});

caso('falla cuando aparece un error nuevo', () => {
  fuentes({ 'uno.ts': CON_ERROR_A, 'dos.ts': CON_ERROR_B });
  const { codigo, salida } = correr();
  assert.equal(codigo, 1);
  assert.match(salida, /NUEVOS \(1\)/);
  assert.match(salida, /TS2322/);
});

caso('NO falla cuando solo se resuelven errores', () => {
  fuentes({ 'uno.ts': LIMPIO, 'dos.ts': LIMPIO });
  const { codigo, salida } = correr();
  assert.equal(codigo, 0, salida);
  assert.match(salida, /Firmas resueltas\s*:\s*1/);
});

// EL CASO QUE UN CONTADOR NO PUEDE VER.
// Se arregla el error de `uno.ts` y aparece otro en `dos.ts`: el total sigue
// siendo 1, asi que `BASELINE_TOTAL` habria dado verde.
caso('caza la SUSTITUCION: uno resuelto y uno nuevo, total identico', () => {
  fuentes({ 'uno.ts': LIMPIO, 'dos.ts': CON_ERROR_B });
  const { codigo, salida } = correr();
  assert.match(salida, /Errores ahora\s*:\s*1/);
  assert.match(salida, /Errores en la base\s*:\s*1/, 'el total no cambia: es el punto');
  assert.equal(codigo, 1, 'un contador daria verde aqui');
  assert.match(salida, /NUEVOS \(1\)/);
});

// La firma no lleva linea ni columna: mover el error hacia abajo no lo vuelve
// nuevo. Sin esto, meter una linea en blanco arriba pondria en rojo el archivo
// entero — paso de verdad el 11-sep-2026 al editar `src/types/index.ts`.
caso('desplazar el error de linea NO lo cuenta como nuevo', () => {
  fuentes({ 'uno.ts': CON_ERROR_A, 'dos.ts': LIMPIO });
  correr(['--update']);
  fuentes({ 'uno.ts': `\n\n// dos lineas nuevas arriba\n${CON_ERROR_A}`, 'dos.ts': LIMPIO });
  const { codigo, salida } = correr();
  assert.equal(codigo, 0, salida);
  assert.match(salida, /Sin errores de tipos nuevos/);
});

// Un check que no corre NO es un check verde.
caso('aborta con codigo 2 si tsc no llega a correr', () => {
  fuentes({ 'uno.ts': LIMPIO });
  const opciones = {
    cwd: raiz, encoding: 'utf8',
    env: { ...process.env, FRONT_TSCONFIG: TSCONFIG, FRONT_BASELINE: BASELINE, FRONT_TSC: 'no/existe/tsc' },
  };
  let codigo = 0, salida = '';
  try { execFileSync('node', [GUARDIA], opciones); } catch (e) { codigo = e.status; salida = (e.stdout ?? '') + (e.stderr ?? ''); }
  assert.equal(codigo, 2, 'no encontrar tsc no puede pasar por "sin errores"');
  assert.match(salida, /no se encontro|No se puede concluir/);
});

caso('aborta con codigo 2 si falta la linea base', () => {
  fuentes({ 'uno.ts': LIMPIO });
  rmSync(BASELINE, { force: true });
  const { codigo, salida } = correr();
  assert.equal(codigo, 2);
  assert.match(salida, /no existe la linea base/);
});

rmSync(raiz, { recursive: true, force: true });
console.log(`\n${casos} casos, todos ok`);
