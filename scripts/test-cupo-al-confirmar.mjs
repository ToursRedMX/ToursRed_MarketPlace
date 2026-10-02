/**
 * Prueba de supabase/functions/_shared/cupoAlConfirmar.ts.
 *
 * El 02-oct-2026 Stripe cobro $589 por la reserva TRG-QVPXGI5I1DQ y
 * stripe-webhook la dejo en pending: "Insufficient availability. Available: 0,
 * Required: 1". El horario estaba a 5 de 20. La funcion que decidia,
 * get_tour_availability(tour), restaba las 34 reservas de TODAS las fechas del
 * tour contra la capacidad de un viaje (10), contando a la propia reserva.
 *
 * Los numeros de abajo son los de ese dia, leidos de la base.
 *
 * Tambien se comprueba que el webhook USA la regla y no vuelve a llamar a
 * get_tour_availability cuando la reserva tiene horario, y que no cumplir
 * nunca termina en un `break` mudo.
 *
 *   node scripts/test-cupo-al-confirmar.mjs
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

const { motivoParaNoConfirmar } = await import(
  pathToFileURL(path.join(RAIZ, 'supabase', 'functions', '_shared', 'cupoAlConfirmar.ts')).href
);

let casos = 0;
const caso = (nombre, fn) => { fn(); casos += 1; console.log(`  ok  ${nombre}`); };

const HORARIO = '1dc19d48-ea42-4587-bb7d-49c3a83f8c76';

caso('el caso del 02-oct: horario 5/20 se confirma aunque el tour "acumulado" de 0', () => {
  assert.equal(motivoParaNoConfirmar({
    slotId: HORARIO, viajeros: 1,
    horario: { capacity: 20, booked_count: 5 },
    disponibleEnTour: 0, // lo que devolvia get_tour_availability: no debe importar
  }), null);
});

caso('horario lleno justo (20/20, contando a esta reserva) se confirma', () => {
  assert.equal(motivoParaNoConfirmar({ slotId: HORARIO, viajeros: 2, horario: { capacity: 20, booked_count: 20 } }), null);
});

caso('horario sobrevendido (21/20) NO se confirma y dice por que', () => {
  const m = motivoParaNoConfirmar({ slotId: HORARIO, viajeros: 1, horario: { capacity: 20, booked_count: 21 } });
  assert.match(m, /sobrevendido: 21 de 20/);
});

caso('valores numericos como texto (asi llegan de PostgREST a veces) se leen bien', () => {
  assert.equal(motivoParaNoConfirmar({ slotId: HORARIO, viajeros: 1, horario: { capacity: '20', booked_count: '5' } }), null);
});

caso('si no se puede leer el horario, no se confirma (y hay motivo, no silencio)', () => {
  assert.match(motivoParaNoConfirmar({ slotId: HORARIO, viajeros: 1, horario: null, errorHorario: 'timeout' }), /timeout/);
  assert.match(motivoParaNoConfirmar({ slotId: HORARIO, viajeros: 1, horario: null }), /no existe/);
  assert.match(motivoParaNoConfirmar({ slotId: HORARIO, viajeros: 1, horario: { capacity: null, booked_count: 'x' } }), /ilegible/);
});

caso('reserva vieja sin horario: se conserva el chequeo por tour', () => {
  assert.equal(motivoParaNoConfirmar({ slotId: null, viajeros: 2, disponibleEnTour: 3 }), null);
  assert.match(motivoParaNoConfirmar({ slotId: null, viajeros: 2, disponibleEnTour: 1 }), /sin cupo: 1 libres/);
  assert.match(motivoParaNoConfirmar({ slotId: null, viajeros: 1, disponibleEnTour: null }), /sin filas/);
});

// --- El webhook usa la regla ---------------------------------------------------

const webhook = fs.readFileSync(path.join(RAIZ, 'supabase', 'functions', 'stripe-webhook', 'index.ts'), 'utf8');

caso('stripe-webhook decide con motivoParaNoConfirmar', () => {
  assert.match(webhook, /from "\.\.\/_shared\/cupoAlConfirmar\.ts"/);
  assert.ok((webhook.match(/motivoParaNoConfirmar\(/g) ?? []).length >= 2, 'debe usarse en las dos ramas (con y sin horario)');
});

caso('get_tour_availability solo se llama en la rama SIN horario', () => {
  const llamadas = [...webhook.matchAll(/rpc\('get_tour_availability'/g)];
  assert.equal(llamadas.length, 1, `se esperaba 1 llamada, hay ${llamadas.length}`);
  const antes = webhook.slice(0, llamadas[0].index);
  assert.ok(antes.lastIndexOf('} else {') > antes.lastIndexOf('if (booking.slot_id)'),
    'la llamada debe estar en el else de `if (booking.slot_id)`');
});

caso('no confirmar un pago cobrado deja rastro y avisa a operaciones', () => {
  const i = webhook.indexOf('if (motivoSinCupo) {');
  assert.ok(i > 0, 'falta el bloque if (motivoSinCupo)');
  const bloque = webhook.slice(i, webhook.indexOf('break;', i));
  assert.match(bloque, /registrarFallo\(/);
  assert.match(bloque, /alertarOps\(/);
});

console.log(`\n${casos} casos OK: un pago cobrado no se queda sin confirmar por un cupo mal medido.`);
