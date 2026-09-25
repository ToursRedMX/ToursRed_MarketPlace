#!/usr/bin/env node
/**
 * `llamadaInterna(req)` de `_shared/auth.ts`: reconoce al service role por
 * `apikey` o por Bearer, y a nadie mas.
 *
 * El caso que motivo el helper es el segundo de abajo: con verify_jwt = true
 * el gateway reemplaza el Bearer del servicio por un JWT acunado
 * (`sb_api_key_compatibility: minted`) y solo el `apikey` conserva la llave.
 *
 * USO
 *
 *   node scripts/test-llamada-de-servicio.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const LLAVE = 'sb_secret_llave-de-prueba-0123456789';
// auth.ts importa createClient, que aqui no se usa: llamadaInterna no toca la base.
const fuente = readFileSync('supabase/functions/_shared/auth.ts', 'utf8').replace(/^import[^\n]*\n/gm, '');
const js = ts.transpileModule(fuente, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function cargar(llave) {
  const contexto = {
    exports: {}, Request, Headers,
    Deno: { env: { get: (n) => (n === 'SUPABASE_SERVICE_ROLE_KEY' ? llave : undefined) } },
  };
  vm.runInNewContext(js, contexto);
  return contexto.exports.llamadaInterna;
}

const esServicio = cargar(LLAVE);
const pedir = (h) => new Request('https://x.invalid/functions/v1/f', { method: 'POST', headers: h });
const JWT_ACUNADO = 'eyJhbGciOiJFUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.firma';

const casos = [
  [{ apikey: LLAVE, Authorization: `Bearer ${LLAVE}` }, true,
    'verify_jwt = false: la llave llega en los dos'],
  [{ apikey: LLAVE, Authorization: `Bearer ${JWT_ACUNADO}` }, true,
    'verify_jwt = true: el gateway cambio el Bearer y solo el apikey trae la llave'],
  [{ Authorization: `Bearer ${LLAVE}` }, true,
    'cron por pg_net: solo Bearer con la llave'],
  [{ apikey: 'sb_publishable_abc', Authorization: 'Bearer eyJ.usuario.jwt' }, false,
    'navegador con sesion: publicable + JWT de usuario'],
  [{ apikey: 'sb_publishable_abc', Authorization: `Bearer ${JWT_ACUNADO}` }, false,
    'un JWT con role service_role NO basta: sin verificar la firma se puede fabricar'],
  [{ apikey: LLAVE.slice(0, -1) + 'X' }, false, 'una llave casi igual no pasa'],
  [{ apikey: LLAVE + 'X' }, false, 'una llave mas larga no pasa'],
  [{}, false, 'sin cabeceras'],
  [{ apikey: '', Authorization: 'Bearer ' }, false, 'cabeceras vacias'],
];

for (const [cabeceras, esperado, nota] of casos) {
  assert.equal(esServicio(pedir(cabeceras)), esperado, nota);
}

// Sin la llave en el entorno nada pasa, ni siquiera una cadena vacia contra otra.
const sinLlave = cargar(undefined);
assert.equal(sinLlave(pedir({ apikey: '', Authorization: 'Bearer ' })), false,
  'sin SUPABASE_SERVICE_ROLE_KEY no se reconoce a nadie como servicio');

console.log(`Llamada de servicio: ${casos.length + 1} casos.`);
