#!/usr/bin/env node
/**
 * `x-correlation-id` va a PostgREST y NO a las Edge Functions.
 *
 * Del 11 al 25-sep-2026 el front la mando tambien a las funciones (via
 * `global.headers`), y como ninguna la admite en CORS, cada
 * `supabase.functions.invoke()` del navegador se cayo en el preflight. Esta
 * prueba ejercita el cliente REAL de supabase-js con el `fetch` de
 * `src/lib/fetchConCorrelacion.ts` y mira que cabeceras salen en cada camino.
 *
 * USO
 *
 *   node scripts/test-correlacion-front.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const fuente = readFileSync('src/lib/fetchConCorrelacion.ts', 'utf8');
const js = ts.transpileModule(fuente, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const contexto = { exports: {}, Headers, Request, URL, fetch };
vm.runInNewContext(js, contexto);
const { crearFetchConCorrelacion } = contexto.exports;

const CORR = '11111111-2222-4333-8444-555555555555';
const vistas = [];
const fetchFalso = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input);
  vistas.push({ url, cabeceras: new Headers(init?.headers) });
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};

const cliente = createClient('https://proyecto.invalid', 'sb_publishable_prueba', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: crearFetchConCorrelacion(CORR, fetchFalso) },
});

// 1. PostgREST: la correlacion tiene que llegar, es para lo que existe.
await cliente.from('tours').select('id');
const rest = vistas.find((v) => v.url.includes('/rest/v1/'));
assert.ok(rest, 'no salio ninguna peticion a PostgREST');
assert.equal(rest.cabeceras.get('x-correlation-id'), CORR,
  'PostgREST tiene que recibir la correlacion de la pestana');
assert.ok(rest.cabeceras.get('apikey'), 'no se pierden las cabeceras propias de supabase-js');

// 2. Edge Functions: NO puede llegar, o el navegador corta el preflight.
await cliente.functions.invoke('process-traveler-cancellation', { body: { booking_id: 'x' } });
const fn = vistas.find((v) => v.url.includes('/functions/v1/'));
assert.ok(fn, 'no salio ninguna peticion a Edge Functions');
assert.equal(fn.cabeceras.get('x-correlation-id'), null,
  'functions.invoke no puede mandar x-correlation-id: ninguna Edge Function lo admite en CORS');
assert.ok(fn.cabeceras.get('apikey'), 'la llamada a la funcion conserva sus cabeceras');

// 3. Una correlacion explicita del llamador gana.
vistas.length = 0;
await cliente.from('tours').select('id').setHeader('x-correlation-id', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
assert.equal(vistas[0].cabeceras.get('x-correlation-id'), 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  'lo explicito del llamador no se pisa');

// 4. supabase.ts ya no la pone en global.headers.
const lib = readFileSync('src/lib/supabase.ts', 'utf8').replace(/\/\/.*$/gm, '');
assert.doesNotMatch(lib, /headers\s*:\s*\{[^}]*x-correlation-id/,
  'x-correlation-id volvio a global.headers: functions.invoke la mandaria a las Edge Functions');
assert.match(lib, /fetch\s*:\s*crearFetchConCorrelacion\(/,
  'supabase.ts tiene que usar crearFetchConCorrelacion como global.fetch');

console.log('Correlacion del front: llega a PostgREST, no a Edge Functions (4 comprobaciones).');
