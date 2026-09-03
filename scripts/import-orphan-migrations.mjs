#!/usr/bin/env node
/**
 * Escribe supabase/migrations/{version}_{name}.sql a partir de una exportacion
 * de supabase_migrations.schema_migrations.
 *
 * Existe porque 153 migraciones aplicadas no tienen archivo en el repo: su SQL
 * solo vive dentro de la base, no es revisable en un PR ni reproducible en un
 * entorno nuevo, y `supabase db push` no corre por eso.
 *
 * ----------------------------------------------------------------------------
 * COMO USARLO
 *
 * 1. En el SQL editor del Dashboard de Supabase, correr la consulta que esta
 *    en scripts/export-orphan-migrations.sql y descargar el resultado como
 *    JSON (boton "Download" del editor).
 *
 * 2. node scripts/import-orphan-migrations.mjs <archivo.json>
 *
 * El paso 1 lo tiene que hacer una persona con acceso a la base: este repo no
 * guarda cadena de conexion y el CLI no esta linkeado.
 *
 * ----------------------------------------------------------------------------
 * QUE PRODUCE, Y QUE NO
 *
 * Cada archivo lleva una cabecera diciendo que es una EXPORTACION FUNCIONAL,
 * no el archivo original. La diferencia importa:
 *
 *   - Se recupera: las sentencias que la base ejecuto, en su orden.
 *   - Se pierde:   los comentarios sueltos entre sentencias. El ledger guarda
 *                  solo sentencias ejecutables, asi que el razonamiento escrito
 *                  en el archivo original se descarto al aplicarse. Verificado
 *                  el 02-sep-2026 reconstruyendo una migracion que SI tiene
 *                  archivo (20260901064136) y comparandola: se perdieron 16
 *                  lineas de cabecera y todos los comentarios de seccion.
 *                  Los comentarios de bloque pegados a una sentencia si
 *                  sobreviven.
 *   - Se transforma: los saltos de linea vienen escapados como \n literal en
 *                  18,624 de 19,048 sentencias y hay que restaurarlos; los ';'
 *                  separadores se reponen porque statements[] no los conserva
 *                  (solo 106 de 19,048 lo traen). El ';' va en su propia linea
 *                  porque 4,162 sentencias terminan en comentario de linea y
 *                  pegarlo lo dejaria dentro del comentario.
 *
 * La consulta de exportacion ya aplica esas transformaciones; este script solo
 * reparte en archivos y pone la cabecera.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const DEST = 'supabase/migrations';

const input = process.argv[2];
if (!input || !existsSync(input)) {
  console.error('ERROR: falta el archivo exportado (o no existe).');
  console.error('Uso: node scripts/import-orphan-migrations.mjs <archivo.json>');
  process.exit(2);
}

let filas;
try {
  filas = JSON.parse(readFileSync(input, 'utf8'));
} catch (e) {
  console.error(`ERROR: no se pudo parsear ${input} como JSON: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(filas) || filas.length === 0) {
  console.error('ERROR: se esperaba un arreglo JSON no vacio.');
  process.exit(2);
}

const cabecera = (version, name) => `-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: ${version}
--   name:    ${name}
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

`;

if (!existsSync(DEST)) mkdirSync(DEST, { recursive: true });

let escritos = 0, vacios = 0, omitidos = 0;
const manifiesto = [];

for (const f of filas) {
  const version = String(f.version ?? '').trim();
  const name = String(f.name ?? '').trim();
  const cuerpo = f.cuerpo ?? f.body ?? '';

  if (!/^\d{14}$/.test(version)) {
    console.error(`  omitida: version invalida ${JSON.stringify(f.version)}`);
    omitidos++;
    continue;
  }

  const slug = (name || 'sin_nombre').replace(/[^A-Za-z0-9_.-]/g, '_');
  const ruta = join(DEST, `${version}_${slug}.sql`);

  let contenido = cabecera(version, name || '(sin nombre)');
  if (!cuerpo.trim()) {
    contenido += '-- El ledger no registro ninguna sentencia para esta version.\n';
    vacios++;
  } else {
    contenido += cuerpo.endsWith('\n') ? cuerpo : cuerpo + '\n';
  }

  writeFileSync(ruta, contenido, 'utf8');
  manifiesto.push({
    version,
    archivo: ruta,
    md5_cuerpo: createHash('md5').update(cuerpo, 'utf8').digest('hex'),
    bytes_cuerpo: Buffer.byteLength(cuerpo, 'utf8'),
  });
  escritos++;
}

const rutaManifiesto = 'migraciones-exportadas.manifiesto.json';
writeFileSync(rutaManifiesto, JSON.stringify(manifiesto, null, 2), 'utf8');

console.log(`\nArchivos escritos : ${escritos}`);
console.log(`  sin sentencias  : ${vacios}`);
console.log(`  omitidos        : ${omitidos}`);
console.log(`Manifiesto        : ${rutaManifiesto}`);
console.log(`\nVerificar fidelidad: comparar md5_cuerpo del manifiesto contra`);
console.log(`el md5 que devuelve la consulta de exportacion. Si alguno no cuadra,`);
console.log(`el archivo NO es fiel y hay que reexportarlo.\n`);

process.exit(omitidos ? 1 : 0);
