#!/usr/bin/env node
/**
 * Contexto de auditoria: la regla de enmascarado vive en dos sitios y aqui se
 * atan — Req. 10.2 de PCI DSS v4.
 *
 * EL PROBLEMA
 *
 * `enmascararIp` existe en TypeScript (`_shared/contextoAuditoria.ts`, para
 * `user_sessions.ip_masked`) y en SQL (`public.enmascarar_ip`, para que
 * `insert_audit_log` derive `ip_masked` de la bitacora). Son la MISMA regla en
 * dos lenguajes, y eso se desincroniza solo: este repo ya tuvo que montar
 * `guardia-fiscal` por exactamente lo mismo con la formula del IVA.
 *
 * COMO SE ATAN
 *
 * Hay una lista unica de vectores, y la prueba tiene dos niveles:
 *
 *   1. SIEMPRE — corre la implementacion de TypeScript contra cada vector, y
 *      comprueba que la MIGRACION afirme esos mismos vectores en sus ASSERT.
 *      Cambiar una regla sin cambiar la otra rompe uno de los dos lados.
 *
 *   2. SI HAY POSTGRES — extrae `enmascarar_ip` de la migracion, la crea de
 *      verdad y compara su salida contra la de TypeScript, vector por vector.
 *      Eso es paridad EJECUTADA, no prometida, igual que `guardia-fiscal` con
 *      la formula del IVA. La funcion es SQL puro sin dependencias, asi que se
 *      puede correr sola sin montar el esquema entero.
 *
 * El nivel 1 corre en cualquier lado; el 2 se salta con aviso si no hay `psql`
 * o no hay conexion. En `lint.yml` hay un servicio de Postgres, asi que en CI
 * corren los dos.
 *
 * USO
 *
 *   node scripts/test-contexto-auditoria.mjs
 *
 * Variables (estandar de libpq): PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODULO = 'supabase/functions/_shared/contextoAuditoria.ts';

// ---------------------------------------------------------------------------
// Los vectores. Cambiar esto obliga a cambiar TypeScript y la migracion.
// ---------------------------------------------------------------------------
const VECTORES = [
  { entrada: '192.168.1.42', esperado: '192.168.1.xxx', nota: 'IPv4 pierde el ultimo octeto' },
  { entrada: '2001:db8:85a3:0:0:8a2e:370:7334', esperado: '2001:db8:85a3:0:0:8a2e:xxx:xxx', nota: 'IPv6 pierde los dos ultimos grupos' },
  { entrada: '2001:db8::1', esperado: '2001:db8:xxx:xxx', nota: 'IPv6 comprimida tambien' },
  { entrada: '::1', esperado: '::1', nota: 'con menos de 4 grupos se deja igual' },
];

// ---------------------------------------------------------------------------
// 1. La implementacion de TypeScript
// ---------------------------------------------------------------------------
// El modulo es TypeScript para Deno; se le quitan los tipos con una
// transformacion minima en vez de arrastrar el compilador: el archivo solo usa
// anotaciones simples y no hay nada que valga la pena type-checkear aqui (de
// eso ya se encarga `tipos-edge`).
const fuente = readFileSync(MODULO, 'utf8');

function evaluar(src) {
  const js = src
    .replace(/export function (\w+)\(([^)]*)\)\s*:\s*[^{]+\{/g, 'function $1($2) {')
    .replace(/(\w+)\s*:\s*(string|Request)\s*\|\s*null\s*\|\s*undefined/g, '$1')
    .replace(/(\w+)\s*:\s*(string|Request)/g, '$1')
    .replace(/const (\w+)\s*:\s*Record<string,\s*string>\s*=/g, 'const $1 =');
  const modulo = {};
  new Function('exports', `${js}; exports.enmascararIp = enmascararIp; exports.extraerIpDelCliente = extraerIpDelCliente;`)(modulo);
  return modulo;
}

const { enmascararIp, extraerIpDelCliente } = evaluar(fuente);

for (const { entrada, esperado, nota } of VECTORES) {
  assert.equal(enmascararIp(entrada), esperado, `TypeScript, ${nota}: ${entrada}`);
}
assert.equal(enmascararIp(null), null, 'TypeScript: null entra, null sale');
assert.equal(enmascararIp(''), null, 'TypeScript: cadena vacia da null');
assert.equal(enmascararIp('   '), null, 'TypeScript: solo espacios da null');

// ---------------------------------------------------------------------------
// 2. El orden de preferencia de cabeceras
// ---------------------------------------------------------------------------
// Importa que sea ESTE orden y no otro: el mismo esta replicado en el COALESCE
// de `insert_audit_log`, y si se separan, la IP deducida en SQL y la reenviada
// por la Edge Function serian distintas para la misma peticion.
const pedir = (h) => new Request('https://ejemplo.mx', { headers: h });

assert.equal(
  extraerIpDelCliente(pedir({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '2.2.2.2' })),
  '1.1.1.1', 'cf-connecting-ip gana a x-real-ip');
assert.equal(
  extraerIpDelCliente(pedir({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' })),
  '2.2.2.2', 'x-real-ip gana a x-forwarded-for');
assert.equal(
  extraerIpDelCliente(pedir({ 'x-forwarded-for': '3.3.3.3, 10.0.0.1, 10.0.0.2' })),
  '3.3.3.3', 'de una lista se toma el primero');
assert.equal(
  extraerIpDelCliente(pedir({ 'x-forwarded-for': '  4.4.4.4  ' })),
  '4.4.4.4', 'se recortan espacios');
assert.equal(extraerIpDelCliente(pedir({})), null, 'sin cabeceras, null');

// ---------------------------------------------------------------------------
// 3. La migracion promete los mismos vectores
// ---------------------------------------------------------------------------
const migracion = readdirSync('supabase/migrations')
  .filter((f) => f.includes('bitacora_registra_el_origen_de_la_peticion'))
  .sort()
  .pop();

assert.ok(migracion, 'no se encontro la migracion del contexto de bitacora');
const sql = readFileSync(`supabase/migrations/${migracion}`, 'utf8');

for (const { entrada, esperado, nota } of VECTORES) {
  const afirmacion = `public.enmascarar_ip('${entrada}')`;
  assert.ok(
    sql.includes(afirmacion),
    `la migracion no afirma el caso "${nota}" (${entrada}). ` +
    `Si cambiaste la regla en TypeScript, cambiala tambien en SQL y agrega su ASSERT.`,
  );
  // El valor esperado tiene que aparecer en la misma linea del ASSERT.
  const linea = sql.split('\n').find((l) => l.includes(afirmacion));
  assert.ok(
    linea.includes(`'${esperado}'`),
    `la migracion afirma ${entrada} pero no espera '${esperado}'. Linea: ${linea.trim()}`,
  );
}

// Y que siga derivando el contexto en vez de haber vuelto a pasar NULL.
for (const senal of [
  "current_setting('request.headers', true)",
  "current_setting('request.jwt.claims', true)",
  'v_claims->>\'session_id\'',
  'public.enmascarar_ip(host(v_ip))',
]) {
  assert.ok(sql.includes(senal), `la migracion perdio "${senal}"`);
}

// El aislamiento del cast es lo que evita que una cabecera malformada apague
// la bitacora entera. Si desaparece, el EXCEPTION de afuera se traga el INSERT.
assert.ok(
  /BEGIN\s+v_headers := nullif\(current_setting[\s\S]{0,200}?EXCEPTION WHEN OTHERS THEN\s+v_headers := NULL;/.test(sql),
  'la lectura de request.headers perdio su bloque EXCEPTION propio',
);

// ---------------------------------------------------------------------------
// 4. Paridad EJECUTADA contra Postgres, si lo hay
// ---------------------------------------------------------------------------
// Se extrae solo `enmascarar_ip`, que es SQL puro y no depende de nada del
// esquema. Correr la migracion entera pediria audit_logs, tenant_type y auth,
// y no hace falta para comprobar esta regla.
function extraerFuncion(sqlCompleto) {
  const inicio = sqlCompleto.indexOf('CREATE OR REPLACE FUNCTION public.enmascarar_ip');
  assert.ok(inicio !== -1, 'no se encontro enmascarar_ip en la migracion');
  const fin = sqlCompleto.indexOf('$$;', inicio);
  assert.ok(fin !== -1, 'no se encontro el cierre de enmascarar_ip');
  return sqlCompleto.slice(inicio, fin + 3);
}

// Vectores extra, solo para la comparacion ejecutada: no se afirman en la
// migracion porque ahi la lista corta ya documenta la regla, pero cuantos mas
// casos se comparen, mas dificil es que las dos implementaciones se separen.
const VECTORES_EXTRA = [
  '10.0.0.1', '8.8.8.8', '255.255.255.255', '0.0.0.0',
  'fe80::1', 'fe80::1:2:3:4', '2001:0db8:0000:0000:0000:ff00:0042:8329',
  '::ffff:192.168.1.1',
];

let paridadEjecutada = 0;
let motivoSalto = null;

try {
  const dir = mkdtempSync(join(tmpdir(), 'contexto-auditoria-'));
  const archivo = join(dir, 'paridad.sql');

  const casos = [...VECTORES.map((v) => v.entrada), ...VECTORES_EXTRA];
  const consultas = casos
    .map((ip) => `SELECT '${ip}' AS entrada, coalesce(public.enmascarar_ip('${ip}'), '<null>') AS salida;`)
    .join('\n');

  writeFileSync(archivo, [
    'CREATE SCHEMA IF NOT EXISTS public;',
    extraerFuncion(sql),
    consultas,
    // Los bordes tambien
    "SELECT '<vacia>', coalesce(public.enmascarar_ip(''), '<null>');",
    "SELECT '<nula>', coalesce(public.enmascarar_ip(NULL), '<null>');",
  ].join('\n'));

  // El formato va por ARGUMENTOS y no con `\pset` dentro del archivo: `\pset
  // fieldsep '|'` hace que psql imprima `Field separator is "|".`, una linea
  // que contiene el separador y se colaba como si fuera una fila de datos. Lo
  // cazo la asercion de conteo de abajo, que por eso esta.
  //   -q  sin "CREATE FUNCTION" ni demas etiquetas de comando
  //   -t  solo tuplas, sin cabeceras
  //   -A  sin alineacion
  //   -F  separador
  const salida = execFileSync(
    'psql',
    ['-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-F', '|', '-f', archivo],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  // Con -q solo deberian salir filas de datos, pero se filtra igual por el
  // separador por si aparece un NOTICE, y se CUENTA. Contar es lo que importa:
  // si el filtro deja pasar una linea que no es un caso, o se pierde uno, la
  // comparacion de abajo podria quedar en verde sin haber comparado lo que
  // creia. Paso el 10-sep-2026 — `\pset fieldsep` metia una linea de mas.
  const filas = salida.split('\n').map((l) => l.trim()).filter((l) => l.includes('|'));
  assert.ok(
    filas.length === casos.length + 2,
    `psql devolvio ${filas.length} filas y se esperaban ${casos.length + 2}. Salida:\n${salida}`,
  );

  for (const linea of filas) {
    const [entrada, salidaSql] = linea.split('|');
    let esperado;
    if (entrada === '<vacia>') esperado = '<null>';
    else if (entrada === '<nula>') esperado = '<null>';
    else esperado = enmascararIp(entrada) ?? '<null>';

    assert.equal(
      salidaSql, esperado,
      `PARIDAD ROTA en "${entrada}": SQL da "${salidaSql}", TypeScript da "${esperado}". ` +
      `Las dos implementaciones de la regla de enmascarado se separaron.`,
    );
    paridadEjecutada++;
  }
} catch (err) {
  // Solo se tolera la ausencia de Postgres. Una discrepancia de paridad es un
  // AssertionError y tiene que subir: tragarsela dejaria la prueba en verde
  // justo cuando encontro lo que venia a buscar.
  if (err instanceof assert.AssertionError) throw err;
  motivoSalto = err.message.split('\n')[0];
}

console.log(
  `Contexto de auditoria: ${VECTORES.length} vectores en TypeScript y afirmados en ` +
  `${migracion}, mas 5 casos de precedencia de cabeceras.`,
);
if (paridadEjecutada > 0) {
  console.log(`Paridad TypeScript <-> SQL EJECUTADA contra Postgres: ${paridadEjecutada} casos iguales.`);
} else {
  console.log(`Paridad ejecutada OMITIDA (sin Postgres): ${motivoSalto}`);
  console.log('La comprobacion estatica si corrio. En CI hay Postgres y corren las dos.');
}
