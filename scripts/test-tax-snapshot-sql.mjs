/**
 * Corre `scripts/test-tax-snapshot-sql.sql` contra un Postgres de verdad.
 *
 * ============================================================================
 * QUE PROTEGE ESTO
 * ============================================================================
 *
 * La formula de IVA existe TRES veces en el repo:
 *
 *   1. src/utils/taxBreakdown.ts                    <- la canonica
 *   2. supabase/functions/_shared/taxBreakdown.ts   <- la copia para Deno
 *   3. compute_tax_snapshot() en plpgsql            <- dentro de la base
 *
 * La tercera existe porque un trigger no puede importar TypeScript, asi que se
 * tradujo A MANO. Y corre en el trigger que escribe el snapshot fiscal en cada
 * cobro: esos numeros son los que despues van al CFDI. Si la copia en SQL se
 * separa de la canonica, la reserva guarda un desglose y el CFDI declara otro.
 *
 * Los valores esperados del .sql no se recalculan: estan clavados con la salida
 * REAL de scripts/test-tax-breakdown.mjs. Asi que la comparacion es contra el
 * numero que produce la canonica, no contra otra lectura de la misma formula.
 *
 * ============================================================================
 * POR QUE HACE FALTA ESTE ENVOLTORIO Y NO BASTA CON `psql -f`
 * ============================================================================
 *
 * El .sql asume una base que YA tiene el tipo y la funcion. En CI la base nace
 * vacia, y aplicar la migracion entera no sirve: `20260901064051` tambien crea
 * tres triggers sobre `bookings`, `booking_supplements` y
 * `booking_optional_services`, que no existen.
 *
 * Levantar esas seis tablas a mano seria inventarse un esquema y probar contra
 * el, que es justo lo que no queremos. Asi que se RECORTA del archivo de
 * migracion solo el enum y la funcion, por conteo de llaves y marcadores, y se
 * ejecuta ESO. El texto que corre es byte a byte el del repo: si alguien edita
 * la funcion, esta prueba ve la edicion.
 *
 *   node scripts/test-tax-snapshot-sql.mjs
 *
 * Variables: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE (las estandar de
 * libpq). En CI apuntan al servicio de Postgres del job `lint`.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MIGRACION_ENUM = 'supabase/migrations/20260901064008_mixed_tax_treatment.sql';
const MIGRACION_FUNCION = 'supabase/migrations/20260901064051_snapshot_tax_on_charge.sql';
const PRUEBA = 'scripts/test-tax-snapshot-sql.sql';

/** Recorta desde `desde` hasta el primer `hasta` que aparezca despues, ambos incluidos. */
function recortar(fuente, desde, hasta, etiqueta) {
  const i = fuente.indexOf(desde);
  assert.notEqual(i, -1, `no se encontro el inicio de ${etiqueta}: ${desde}`);
  const j = fuente.indexOf(hasta, i + desde.length);
  assert.notEqual(j, -1, `no se encontro el final de ${etiqueta}: ${hasta}`);
  return fuente.slice(i, j + hasta.length);
}

const fuenteEnum = readFileSync(MIGRACION_ENUM, 'utf8');
const fuenteFuncion = readFileSync(MIGRACION_FUNCION, 'utf8');

// El enum vive dentro de un DO idempotente; se recorta entero.
const bloqueEnum = recortar(
  fuenteEnum,
  'DO $$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = \'tax_treatment_enum\')',
  'END$$;',
  'el enum tax_treatment_enum',
);

// La funcion termina en el cierre de su dollar-quote. Se ancla en el COMMENT
// que va justo despues para no depender de contar `$$` sueltos.
const bloqueFuncion = recortar(
  fuenteFuncion,
  'CREATE OR REPLACE FUNCTION public.compute_tax_snapshot(',
  'COMMENT ON FUNCTION public.compute_tax_snapshot IS',
  'la funcion compute_tax_snapshot',
).replace(/COMMENT ON FUNCTION public\.compute_tax_snapshot IS$/, '');

// Si el recorte no trajo el cuerpo, la prueba pasaria contra una funcion vacia.
//
// Ojo con lo que se pone aqui: las senales tienen que ser ESTRUCTURALES, nunca
// la formula. La primera version listaba `ROUND(v_gravado / 1.16, 2)` entre
// ellas, y al probarla por mutacion —cambiando el IVA a 1.15— la prueba fallaba
// con "el recorte no trajo X: revisa los marcadores". Roja, si, pero mandando a
// quien la lea a revisar el recorte cuando lo que cambio fue el impuesto. En una
// prueba fiscal, un mensaje que apunta al lugar equivocado cuesta caro.
for (const senal of ['LANGUAGE plpgsql', 'IMMUTABLE', 'BEGIN', 'RETURN NEXT;']) {
  assert.ok(
    bloqueFuncion.includes(senal),
    `el recorte de compute_tax_snapshot no trajo "${senal}". Cambio el archivo de migracion: revisa los marcadores.`,
  );
}

const guion = [
  '\\set ON_ERROR_STOP on',
  bloqueEnum,
  bloqueFuncion,
  readFileSync(PRUEBA, 'utf8'),
].join('\n\n');

const dir = mkdtempSync(join(tmpdir(), 'tax-snapshot-'));
const archivo = join(dir, 'prueba.sql');
writeFileSync(archivo, guion);

let salida;
try {
  salida = execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-f', archivo], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  console.error(err.stdout ?? '');
  console.error(err.stderr ?? '');
  throw new Error('psql fallo al correr la prueba de paridad fiscal');
}

// El .sql imprime una fila por caso y un veredicto. Se exige el veredicto Y la
// ausencia de FAIL: si un dia el resumen dejara de calcularse, "no encontre
// FAIL" por si solo no probaria nada.
assert.ok(
  salida.includes('PARIDAD SQL<->TS CONFIRMADA'),
  `La traduccion a plpgsql NO preserva la canonica de src/utils/taxBreakdown.ts.\n${salida}`,
);
assert.ok(
  !/\bFAIL\b/.test(salida),
  `Hay casos en FAIL pese al veredicto global:\n${salida}`,
);

const casos = /casos_totales[^\n]*\n[^\n]*\n\s*(\d+)/.exec(salida);
console.log(`Paridad fiscal SQL<->TS: ${casos ? casos[1] : '?'} casos, 0 fallos`);
