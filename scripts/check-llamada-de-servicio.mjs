#!/usr/bin/env node
/**
 * Guardia: nadie reconoce al service role comparando el Bearer con la llave.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` es `sb_secret_...`. En una funcion con
 * `verify_jwt = true`, el gateway reemplaza el Bearer de un llamador de
 * servicio por un JWT que acuna el, y `bearer === SUPABASE_SERVICE_ROLE_KEY`
 * deja de ser cierto. Hasta el 25-sep-2026 trece sitios lo hacian asi, y
 * `cancel-cfdi` rechazaba con 401 a `process-traveler-cancellation`: la
 * reserva se cancelaba y el CFDI quedaba timbrado ante el SAT.
 *
 * Lo correcto es `llamadaInterna(req)` (o `requireServiceRole`) de `_shared/auth.ts`,
 * que mira tambien el `apikey`. Esta guardia marca cualquier comparacion de
 * igualdad contra la llave de servicio fuera de ese modulo.
 *
 * Quita comentarios antes de buscar, igual que check-audit-context.mjs.
 *
 * USO
 *
 *   node scripts/check-llamada-de-servicio.mjs
 */

import { readFileSync, globSync } from 'node:fs';

function sinComentarios(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`])\/\/.*$/gm, (m, p) => p + ' '.repeat(m.length - p.length));
}

const LLAVE = String.raw`(Deno\.env\.get\(\s*["']SUPABASE_SERVICE_ROLE_KEY["']\s*\)|envRequerida\(\s*["']SUPABASE_SERVICE_ROLE_KEY["']\s*\)|\b(supabaseServiceKey|serviceRoleKey|serviceKey)\b)`;
const COMPARA = new RegExp(
  String.raw`(===?|!==?)\s*` + '`?' + String.raw`(Bearer \$\{\s*)?` + LLAVE +
  '|' + LLAVE + String.raw`\s*(===?|!==?)`,
);

const archivos = globSync('supabase/functions/**/*.ts')
  .map((a) => a.replace(/\\/g, '/'))
  .filter((a) => !a.endsWith('_shared/auth.ts'))
  .sort();

const hallazgos = [];
for (const archivo of archivos) {
  const lineas = sinComentarios(readFileSync(archivo, 'utf8')).split('\n');
  lineas.forEach((linea, i) => {
    if (COMPARA.test(linea)) hallazgos.push(`${archivo}:${i + 1}  ${linea.trim()}`);
  });
}

console.log('Guardia de llamadas de servicio');
console.log(`Archivos revisados ..... ${archivos.length}`);
if (hallazgos.length === 0) {
  console.log('Sin hallazgos: nadie compara el Bearer contra la llave de servicio.');
  process.exit(0);
}
console.log(`Hallazgos: ${hallazgos.length}`);
for (const h of hallazgos) console.log(`  ${h}`);
console.log('');
console.log('Con verify_jwt = true el Bearer del servicio llega reemplazado por un JWT acunado.');
console.log('Usa llamadaInterna(req) o requireServiceRole(req, ...) de ../_shared/auth.ts.');
process.exit(1);
