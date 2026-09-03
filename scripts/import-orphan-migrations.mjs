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
 *    en scripts/export-orphan-migrations.sql y descargar el resultado con el
 *    boton "Download" del editor (entrega CSV; tambien se acepta JSON).
 *
 * 2. node scripts/import-orphan-migrations.mjs <archivo.csv|archivo.json>
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

// Parser CSV segun RFC4180: campos entrecomillados pueden contener saltos de
// linea y comillas escapadas como "". Se implementa aqui en vez de usar una
// dependencia porque el SQL exportado trae ambas cosas y un split(',') ingenuo
// destrozaria el contenido en silencio.
function parseCSV(texto) {
  const filas = [];
  let campo = '';
  let fila = [];
  let enComillas = false;
  let i = 0;

  // Quitar BOM si viene
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);

  while (i < texto.length) {
    const c = texto[i];

    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i += 2; continue; }
        enComillas = false; i++; continue;
      }
      campo += c; i++; continue;
    }

    if (c === '"') { enComillas = true; i++; continue; }
    if (c === ',') { fila.push(campo); campo = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; i++; continue; }
    campo += c; i++;
  }

  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila); }
  return filas;
}

function csvAObjetos(texto) {
  const filas = parseCSV(texto);
  if (filas.length < 2) return [];
  const cabecera = filas[0].map((h) => h.trim());
  return filas.slice(1)
    .filter((f) => f.some((v) => v !== ''))
    .map((f) => Object.fromEntries(cabecera.map((h, idx) => [h, f[idx] ?? ''])));
}

const crudo = readFileSync(input, 'utf8');
let filas;

if (input.toLowerCase().endsWith('.csv') || !crudo.trimStart().startsWith('[')) {
  try {
    filas = csvAObjetos(crudo);
  } catch (e) {
    console.error(`ERROR: no se pudo parsear ${input} como CSV: ${e.message}`);
    process.exit(2);
  }
} else {
  try {
    filas = JSON.parse(crudo);
  } catch (e) {
    console.error(`ERROR: no se pudo parsear ${input} como JSON: ${e.message}`);
    process.exit(2);
  }
}

if (!Array.isArray(filas) || filas.length === 0) {
  console.error('ERROR: no se encontro ninguna fila en el archivo.');
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
let verificados = 0, discrepancias = 0, sinMd5 = 0;
const manifiesto = [];
const fallos = [];

for (const f of filas) {
  const version = String(f.version ?? '').trim();
  const name = String(f.name ?? '').trim();
  const cuerpo = f.cuerpo ?? f.body ?? '';

  if (!/^\d{14}$/.test(version)) {
    console.error(`  omitida: version invalida ${JSON.stringify(f.version)}`);
    omitidos++;
    continue;
  }

  // Algunos `name` del ledger ya terminan en .sql (quedaron asi al aplicarse
  // desde un archivo). Sin quitarlo, el archivo sale como `foo.sql.sql`.
  const slug = (name || 'sin_nombre')
    .replace(/\.sql$/i, '')
    .replace(/[^A-Za-z0-9_.-]/g, '_');
  const ruta = join(DEST, `${version}_${slug}.sql`);

  let contenido = cabecera(version, name || '(sin nombre)');
  if (!cuerpo.trim()) {
    contenido += '-- El ledger no registro ninguna sentencia para esta version.\n';
    vacios++;
  } else {
    contenido += cuerpo.endsWith('\n') ? cuerpo : cuerpo + '\n';
  }

  writeFileSync(ruta, contenido, 'utf8');

  // Verificacion de fidelidad: el md5 del cuerpo que quedo en disco debe
  // coincidir con el que calculo la base al exportar. Si no cuadra, el
  // archivo NO es fiel y hay que reexportarlo -- se reporta, no se silencia.
  const md5Local = createHash('md5').update(cuerpo, 'utf8').digest('hex');
  const bytesLocal = Buffer.byteLength(cuerpo, 'utf8');
  const md5Origen = String(f.md5_cuerpo ?? '').trim();
  const bytesOrigen = f.bytes_cuerpo === undefined || f.bytes_cuerpo === ''
    ? null : Number(f.bytes_cuerpo);

  let estado;
  if (!md5Origen) {
    estado = 'sin_md5_de_origen';
    sinMd5++;
  } else if (md5Origen === md5Local && (bytesOrigen === null || bytesOrigen === bytesLocal)) {
    estado = 'ok';
    verificados++;
  } else {
    estado = 'DISCREPANCIA';
    discrepancias++;
    fallos.push({ version, archivo: ruta, md5Origen, md5Local, bytesOrigen, bytesLocal });
  }

  manifiesto.push({
    version,
    archivo: ruta,
    md5_origen: md5Origen || null,
    md5_local: md5Local,
    bytes_origen: bytesOrigen,
    bytes_local: bytesLocal,
    verificacion: estado,
  });
  escritos++;
}

const rutaManifiesto = 'migraciones-exportadas.manifiesto.json';
writeFileSync(rutaManifiesto, JSON.stringify(manifiesto, null, 2), 'utf8');

console.log(`\nArchivos escritos : ${escritos}`);
console.log(`  sin sentencias  : ${vacios}`);
console.log(`  omitidos        : ${omitidos}`);
console.log(`\nVerificacion md5 contra la base:`);
console.log(`  coinciden       : ${verificados}`);
console.log(`  DISCREPANCIAS   : ${discrepancias}`);
console.log(`  sin md5 origen  : ${sinMd5}`);
console.log(`\nManifiesto        : ${rutaManifiesto}`);

if (discrepancias > 0) {
  console.log(`\n${'!'.repeat(60)}`);
  console.log('ARCHIVOS NO FIELES -- reexportar estas versiones:');
  for (const d of fallos) {
    console.log(`  ${d.version}`);
    console.log(`    origen: ${d.md5Origen} (${d.bytesOrigen} bytes)`);
    console.log(`    local : ${d.md5Local} (${d.bytesLocal} bytes)`);
  }
  console.log(`${'!'.repeat(60)}\n`);
} else if (verificados > 0) {
  console.log(`\nTodos los cuerpos coinciden byte a byte con lo exportado.\n`);
}

process.exit(omitidos > 0 || discrepancias > 0 ? 1 : 0);
