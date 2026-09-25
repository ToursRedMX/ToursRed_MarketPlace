#!/usr/bin/env node
/**
 * El flujo de reserva no puede arrancar sin tour.
 *
 * El 25-sep-2026 el Paso 1 salia en blanco con un «Cambiaste la fecha de tu
 * tour» sin haber elegido fecha. `resetFlow()` (al terminar una reserva con
 * wallet, SPEI o pendiente de aprobacion) dejaba `tour: null`, eso se guardaba
 * en sessionStorage, y la siguiente vez el estado guardado ganaba entero al
 * tour recien cargado. El bug venia del 31-jul-2026.
 *
 * USO
 *
 *   node scripts/test-flujo-reserva-estado-inicial.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const ARCHIVO = 'src/context/estadoInicialDelFlujo.ts';
const CONTEXTO = 'src/context/BookingFlowContext.tsx';
const fuente = readFileSync(ARCHIVO, 'utf8');
const js = ts.transpileModule(fuente.replace(/^import[^\n]*\n/gm, ''), {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  },
}).outputText;

const INITIAL_FLOW_STATE = {
  tourId: '', tourSlug: '', tour: null, step: 1, selectedSlot: null,
  selectedSeats: [], pendingRedirectMessage: null,
};
const contexto = {
  exports: {}, INITIAL_FLOW_STATE, totalTravelerCount: () => 0,
  createContext: () => ({}), React: {}, supabase: {},
};
vm.runInNewContext(js, contexto);
const { estadoInicialDelFlujo } = contexto.exports;
assert.equal(typeof estadoInicialDelFlujo, 'function', 'estadoInicialDelFlujo.ts debe exportar estadoInicialDelFlujo');

const tour = { id: 'tour-1', slug: 'teotihuacan', name: 'Tour a Teotihuacan' };

// 1. El caso del 25-sep: lo que dejaba resetFlow() en sessionStorage.
const trasReset = {
  ...INITIAL_FLOW_STATE, tourSlug: 'teotihuacan', tour: null, tourId: '',
  pendingRedirectMessage: 'Cambiaste la fecha de tu tour. Los asientos que tenias apartados ya no aplican — selecciona asientos para la nueva fecha.',
};
const e1 = estadoInicialDelFlujo(trasReset, 'teotihuacan', tour);
assert.equal(e1.tour, tour, 'el tour recien cargado gana al null guardado: sin el, el Paso 1 no pinta nada');
assert.equal(e1.tourId, 'tour-1', 'el tourId sale del tour cargado');
assert.equal(e1.pendingRedirectMessage, null, 'el aviso guardado no se restaura');

// 2. Un flujo a medias se conserva: el guardado sirve para retomar.
const aMedias = { ...INITIAL_FLOW_STATE, tourSlug: 'teotihuacan', tour, tourId: 'tour-1', step: 2,
  selectedSlot: { id: 'slot-9' } };
const e2 = estadoInicialDelFlujo(aMedias, 'teotihuacan', tour);
assert.equal(e2.step, 2, 'se retoma el paso guardado');
assert.equal(e2.selectedSlot.id, 'slot-9', 'se retoma la fecha guardada');

// 3. El tour guardado nunca gana a uno recien cargado (puede estar viejo).
const viejo = { ...tour, name: 'nombre viejo' };
const e3 = estadoInicialDelFlujo({ ...aMedias, tour: viejo }, 'teotihuacan', tour);
assert.equal(e3.tour.name, 'Tour a Teotihuacan', 'el tour cargado gana al guardado');

// 4. Sin nada guardado.
const e4 = estadoInicialDelFlujo(null, 'teotihuacan', tour);
assert.equal(e4.tour, tour);
assert.equal(e4.tourSlug, 'teotihuacan');
assert.equal(e4.step, 1);

// 5. resetFlow conserva el tour y no deja el aviso de cambio de fecha.
const limpio = readFileSync(CONTEXTO, 'utf8').replace(/\/\/.*$/gm, '');
const reset = limpio.slice(limpio.indexOf('const resetFlow'), limpio.indexOf('}, []);', limpio.indexOf('const resetFlow')));
assert.match(reset, /tour:\s*prev\.tour/, 'resetFlow tiene que conservar el tour');
assert.match(reset, /prevSlotIdRef\.current\s*=\s*null/,
  'resetFlow tiene que avisarle al efecto de asientos que esto no es un cambio de fecha');

console.log('Flujo de reserva: 5 escenarios de estado inicial y reset.');
