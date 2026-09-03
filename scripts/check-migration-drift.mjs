#!/usr/bin/env node
/**
 * Auditoria del desfase entre el ledger de migraciones y los archivos del repo.
 *
 * El problema que resuelve: `supabase_migrations.schema_migrations` guarda una
 * VERSION por migracion aplicada. Si esa version no coincide con el nombre de
 * un archivo del repo, el cambio de esquema no es reconstruible desde el repo
 * y `supabase db push` deja de funcionar (LegacyDbPushMissingLocalError).
 *
 * Pasa incluso haciendo todo bien: el 02-sep-2026 dos migraciones que SI
 * estaban commiteadas se aplicaron desde el Dashboard, y la base les asigno su
 * propio timestamp en vez del del archivo:
 *
 *     aplicado 20260902225507  <->  archivo 20260902160000_add_linkedin_oauth.sql
 *     aplicado 20260902232749  <->  archivo 20260902173000_normalize_x_provider_literal.sql
 *
 * El SQL estaba versionado, pero el ledger quedo apuntando a otro lado. Por eso
 * commitear el SQL no basta: hay que aplicar con la version del archivo, o
 * reconciliar despues.
 *
 * Este script no toca la base ni necesita credenciales: es cómputo puro sobre
 * un volcado que se genera aparte.
 *
 * Uso:
 *   1. Sacar las versiones aplicadas (Dashboard SQL editor, o psql):
 *
 *        select version from supabase_migrations.schema_migrations order by version;
 *
 *   2. Guardar la salida en un archivo (una version por linea; tambien se
 *      aceptan separadas por coma, con comillas o con el nombre al lado):
 *
 *        node scripts/check-migration-drift.mjs versiones.txt
 *
 * Salida: cuantas versiones aplicadas no tienen archivo, cuantos archivos nunca
 * se aplicaron bajo su propia version, y los comandos para reconciliar.
 *
 * Flag --ci: en integracion continua solo debe fallar UNA de las dos
 * direcciones del desfase. Un archivo todavia sin aplicar es lo normal en un
 * PR que agrega una migracion, y hacerlo rojo entrenaria al equipo a ignorar
 * el check. Una version aplicada SIN archivo, en cambio, es el defecto real:
 * alguien aplico sin pasar por un commit. Con --ci el codigo de salida
 * depende solo de esa direccion; la otra se sigue reportando, informativa.
 *
 * Codigos de salida:
 *   0  sin desfase (con --ci: sin aplicadas-sin-archivo)
 *   1  hay desfase (uso normal en auditoria; NO es un error de ejecucion)
 *   2  error de invocacion (falta el archivo, no se pudo leer, etc.)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIRS = ['supabase/migrations', 'supabase/migrations_archive'];
const VERSION_RE = /\b(\d{14})\b/;

const args = process.argv.slice(2);
const modoCI = args.includes('--ci');
const input = args.find((a) => !a.startsWith('--'));
if (!input) {
  console.error('ERROR: falta el archivo con las versiones aplicadas.');
  console.error('');
  console.error('  1. select version from supabase_migrations.schema_migrations order by version;');
  console.error('  2. node scripts/check-migration-drift.mjs <archivo>');
  process.exit(2);
}

if (!existsSync(input)) {
  console.error(`ERROR: no existe el archivo: ${input}`);
  process.exit(2);
}

// ---------- versiones aplicadas (del volcado) ----------
let raw;
try {
  raw = readFileSync(input, 'utf8');
} catch (e) {
  console.error(`ERROR: no se pudo leer ${input}: ${e.message}`);
  process.exit(2);
}

// Tolerante a formatos: una por linea, separadas por coma, con comillas, o con
// el nombre pegado. Solo interesa el sello de 14 digitos.
const applied = new Set();
for (const chunk of raw.split(/[\s,]+/)) {
  const m = chunk.match(VERSION_RE);
  if (m) applied.add(m[1]);
}

if (applied.size === 0) {
  console.error(`ERROR: no se encontro ninguna version (14 digitos) en ${input}.`);
  console.error('Se esperaba la salida de: select version from supabase_migrations.schema_migrations;');
  process.exit(2);
}

// ---------- versiones que existen como archivo ----------
const fileOf = new Map(); // version -> ruta
for (const dir of DIRS) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.sql')) continue;
    const m = f.match(/^(\d{14})/);
    if (m) fileOf.set(m[1], join(dir, f));
  }
}

const appliedSinArchivo = [...applied].filter((v) => !fileOf.has(v)).sort();
const archivoSinAplicar = [...fileOf.keys()].filter((v) => !applied.has(v)).sort();

// ---------- reporte ----------
const pct = (n, total) => (total ? ((n / total) * 100).toFixed(1) : '0.0');

console.log(`\nDesfase de migraciones\n${'='.repeat(60)}\n`);
console.log(`Versiones aplicadas en la base : ${applied.size}`);
console.log(`Archivos .sql en el repo       : ${fileOf.size}`);
DIRS.forEach((d) => {
  if (!existsSync(d)) return;
  const n = readdirSync(d).filter((f) => /^\d{14}.*\.sql$/.test(f)).length;
  console.log(`    ${d.padEnd(32)} ${n}`);
});

console.log(`\nAplicadas SIN archivo en el repo: ${appliedSinArchivo.length} (${pct(appliedSinArchivo.length, applied.size)}%)`);
console.log('  -> su SQL solo existe dentro de la base: no es revisable en un PR');
console.log('     ni reproducible en un entorno nuevo.');

console.log(`\nArchivos NUNCA aplicados bajo su propia version: ${archivoSinAplicar.length}`);
console.log('  -> ojo: puede ser una migracion pendiente de aplicar, o una que SI');
console.log('     se aplico pero quedo registrada con otra version.');

if (appliedSinArchivo.length) {
  console.log(`\n${'-'.repeat(60)}\nAplicadas sin archivo (${appliedSinArchivo.length}):`);
  for (const v of appliedSinArchivo) console.log(`  ${v}`);
}

if (archivoSinAplicar.length) {
  console.log(`\n${'-'.repeat(60)}\nArchivos sin aplicar bajo su version (${archivoSinAplicar.length}):`);
  for (const v of archivoSinAplicar) console.log(`  ${v}  ${fileOf.get(v)}`);
}

// ---------- reconciliacion ----------
// Un archivo sin aplicar cuyo SQL YA corrio bajo otra version es un par a
// reconciliar. No se puede detectar automaticamente cual va con cual (los
// timestamps no coinciden por definicion), asi que se sugiere el patron.
if (appliedSinArchivo.length || archivoSinAplicar.length) {
  console.log(`\n${'='.repeat(60)}\nComo reconciliar un par (version equivocada -> version del archivo)\n`);
  console.log('Cuando el SQL YA se aplico pero quedo con la version equivocada, se');
  console.log('corrige solo el ledger, sin volver a correr el SQL:\n');
  console.log('  supabase migration repair --status reverted <version-equivocada> --linked');
  console.log('  supabase migration repair --status applied  <version-del-archivo> --linked\n');
  console.log('Sin el CLI linkeado, el equivalente en el SQL editor es:\n');
  console.log('  delete from supabase_migrations.schema_migrations where version = \'<version-equivocada>\';');
  console.log('  insert into supabase_migrations.schema_migrations (version, name)');
  console.log('         values (\'<version-del-archivo>\', \'<nombre-del-archivo-sin-version>\');\n');
  console.log('OJO: esto reescribe el historial de migraciones. Revisar cada par a');
  console.log('mano antes de correrlo; no hay forma automatica de saber que version');
  console.log('aplicada corresponde a que archivo.');
}

console.log(`\n${'='.repeat(60)}`);

if (appliedSinArchivo.length === 0 && archivoSinAplicar.length === 0) {
  console.log('Sin desfase: el ledger y los archivos del repo coinciden.\n');
  process.exit(0);
}

if (modoCI) {
  // En CI solo bloquea la direccion que denuncia un cambio aplicado sin commit.
  // Un archivo pendiente de aplicar es lo esperado en un PR que agrega una
  // migracion: hacerlo rojo entrenaria al equipo a ignorar este check.
  if (appliedSinArchivo.length === 0) {
    console.log(
      'Sin cambios aplicados fuera del repo. Quedan ' +
        archivoSinAplicar.length +
        ' archivo(s) sin aplicar bajo su version, que es lo normal antes de aplicarlos.\n',
    );
    process.exit(0);
  }
  console.log(
    'Hay ' +
      appliedSinArchivo.length +
      ' version(es) aplicadas SIN archivo en el repo: un cambio de esquema llego a la'+
      ' base sin pasar por un commit.\n',
  );
  process.exit(1);
}

console.log('Hay desfase entre el ledger y el repo.\n');
process.exit(1);
