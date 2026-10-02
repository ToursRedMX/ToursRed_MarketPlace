/**
 * Prueba del plan de membresia en el carrito mixto (02-oct-2026).
 *
 * El plan viaja como 'mensual'/'anual' desde el flujo de 4 pasos y
 * create_booking_atomic, y como 'monthly'/'annual' en Stripe y memberships.
 * create-checkout-session elegia el precio con `=== 'monthly'`, asi que el
 * mensual caia en el ANUAL ($890 en vez de $89, precios leidos de la API de
 * Stripe ese dia). Y cada pantalla que lee bookings.membership_plan comparaba
 * contra un solo vocabulario.
 *
 * Lo que se comprueba:
 *   1. los dos helpers (Edge y front) traducen igual, y no adivinan;
 *   2. los valores que DE VERDAD produce el paso 3 se entienden — leidos del
 *      fuente, no copiados aqui, para que si alguien agrega 'trimestral' esto
 *      se ponga rojo;
 *   3. nadie vuelve a comparar membership_plan / membershipPlan crudo contra
 *      un literal, y create-checkout-session saca el plan de la reserva.
 *
 *   node scripts/test-plan-membresia.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, '..');

if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

const edge = await import(pathToFileURL(path.join(RAIZ, 'supabase', 'functions', '_shared', 'planMembresia.ts')).href);
const front = await import(pathToFileURL(path.join(RAIZ, 'src', 'lib', 'planMembresia.ts')).href);

let casos = 0;
const caso = (nombre, fn) => { fn(); casos += 1; console.log(`  ok  ${nombre}`); };
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

// --- 1. El helper -------------------------------------------------------------

const ESPERADO = [
  ['mensual', 'monthly'], ['anual', 'annual'],
  ['monthly', 'monthly'], ['annual', 'annual'],
  [' Anual ', 'annual'], ['MENSUAL', 'monthly'],
  ['', null], [null, null], [undefined, null], ['trimestral', null], ['year', null],
];

caso('el mensual NO se cobra como anual: mensual -> monthly, anual -> annual', () => {
  for (const [entrada, salida] of ESPERADO) {
    assert.equal(edge.normalizarPlanMembresia(entrada), salida, `edge(${JSON.stringify(entrada)})`);
  }
});

caso('la copia del front traduce exactamente igual que la de Edge', () => {
  for (const [entrada] of ESPERADO) {
    assert.equal(front.normalizarPlanMembresia(entrada), edge.normalizarPlanMembresia(entrada), JSON.stringify(entrada));
    assert.equal(front.etiquetaPlanMembresia(entrada), edge.etiquetaPlanMembresia(entrada), JSON.stringify(entrada));
  }
});

caso('etiquetas: anual -> Anual, mensual -> Mensual, basura -> null', () => {
  assert.equal(edge.etiquetaPlanMembresia('anual'), 'Anual');
  assert.equal(edge.etiquetaPlanMembresia('monthly'), 'Mensual');
  assert.equal(edge.etiquetaPlanMembresia('x'), null);
});

// --- 2. Los valores reales del flujo ---------------------------------------------

caso('cada plan que el paso 3 puede guardar se entiende', () => {
  const paso3 = leer('src', 'pages', 'booking-flow', 'BookingFlowStep3.tsx');
  const planes = [...paso3.matchAll(/membershipPlan:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(planes.length >= 2, `se esperaban al menos 2 planes en el paso 3, hay ${planes.length}`);
  for (const p of planes) assert.notEqual(edge.normalizarPlanMembresia(p), null, `el paso 3 guarda '${p}' y nadie lo entiende`);
});

caso('el plan que cotiza create_booking_atomic se entiende', () => {
  const migraciones = fs.readdirSync(path.join(RAIZ, 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => /membership_plan'\s*,\s*''\)\s*=\s*'/.test(leer('supabase', 'migrations', f)));
  assert.ok(migraciones.length > 0, 'no se encontro donde create_booking_atomic cotiza el plan');
  const ultima = leer('supabase', 'migrations', migraciones.at(-1));
  const [, plan] = ultima.match(/membership_plan'\s*,\s*''\)\s*=\s*'([^']+)'/);
  assert.equal(edge.normalizarPlanMembresia(plan), 'annual', `la RPC cotiza el anual con '${plan}'`);
});

// --- 3. Guardias ------------------------------------------------------------------

const archivos = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? archivos(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
});

caso('nadie compara bookings.membership_plan crudo contra un literal', () => {
  // Lo peligroso es leer la COLUMNA, que trae cualquiera de los dos
  // vocabularios segun quien creo la reserva. flow.membershipPlan del front no
  // entra: esta tipado 'mensual' | 'anual' | null (src/types/booking-flow.ts) y
  // tsc ya lo cuida. BookingForm.tsx es codigo muerto (CLAUDE.md) con su propio
  // estado 'monthly'/'annual'.
  const excluidos = new Set(['BookingForm.tsx', 'planMembresia.ts']);
  const patron = /[\w)\]?]\.membership_plan\s*[!=]==\s*['"]/;
  const hallazgos = [...archivos(path.join(RAIZ, 'src')), ...archivos(path.join(RAIZ, 'supabase', 'functions'))]
    .filter((p) => !excluidos.has(path.basename(p)))
    .flatMap((p) => leer(path.relative(RAIZ, p)).split('\n')
      .map((l, i) => [l, i + 1])
      .filter(([l]) => patron.test(l))
      .map(([, n]) => `${path.relative(RAIZ, p)}:${n}`));
  assert.deepEqual(hallazgos, [], `Usa normalizarPlanMembresia/etiquetaPlanMembresia en: ${hallazgos.join(', ')}`);
});

caso('create-checkout-session saca el plan de la reserva y valida el precio contra Stripe', () => {
  const fuente = leer('supabase', 'functions', 'create-checkout-session', 'index.ts');
  assert.match(fuente, /normalizarPlanMembresia\(booking\.membership_plan\)/);
  assert.match(fuente, /const priceId = planMembresia === 'monthly'/);
  assert.match(fuente, /stripe\.prices\.retrieve\(priceId\)/);
  assert.doesNotMatch(fuente, /if \(addMembership\)/, 'la membresia la decide la reserva, no el cuerpo de la peticion');
});

console.log(`\n${casos} casos OK: el plan de la membresia se traduce en un solo lugar.`);
