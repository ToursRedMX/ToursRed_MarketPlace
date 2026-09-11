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
import vm from 'node:vm';
import ts from 'typescript';

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
// Se transpila con el compilador de verdad en vez de quitar los tipos a mano
// con expresiones regulares: el modulo tiene genericos y firmas multilinea, y
// un limpiador artesanal se rompe con eso — y, peor, se rompe en silencio.
// Mismo patron que `test-mfa-aal2.mjs`.
//
const fuente = readFileSync(MODULO, 'utf8');

// El modulo NO debe importar nada. Nacio porque las 49 funciones en alcance
// usaban TRES versiones distintas (30 en npm 2.116.0, 13 en npm 2.39.6, 6 en
// jsr 2.114.0) y un import aqui metia una SEGUNDA copia de supabase-js en el
// bundle de las 19 que usaran otra.
//
// Desde la unificacion del 10-sep-2026 hay una sola version, asi que esa
// duplicacion ya no podria darse. La comprobacion se queda porque sigue
// valiendo para lo otro: un modulo compartido que importa supabase-js le impone
// su version a las 49 funciones que lo usan.
//
// Se comprueba sobre el TEXTO y no con un centinela en `require`. Se intento
// primero con el centinela y no servia: `ts.transpileModule` elimina los
// imports que no se usan, asi que meter un import sin usarlo no emitia ningun
// `require` y la prueba pasaba tan campante. Se descubrio metiendo el import a
// proposito para ver fallar la prueba — y no fallo.
const importaAlgo = fuente.split('\n').filter((l) => /^\s*import\s/.test(l));
assert.deepEqual(
  importaAlgo, [],
  `contextoAuditoria.ts no debe importar nada y esta importando:\n  ${importaAlgo.join('\n  ')}\n` +
  'Un import de supabase-js aqui mete una segunda copia en el bundle de las 19 ' +
  'funciones en alcance que usan otra version.',
);

function evaluar(src) {
  const js = ts.transpileModule(src, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const requerir = (especificador) => {
    throw new Error(
      `contextoAuditoria.ts no debe importar nada, y esta importando "${especificador}". ` +
      `Si importa una version de supabase-js, mete una SEGUNDA copia en el bundle de las ` +
      `19 funciones en alcance que usan otra version.`,
    );
  };

  const contexto = { exports: {}, require: requerir, Request, Headers, crypto, console };
  vm.runInNewContext(js, contexto);
  return contexto.exports;
}

const { enmascararIp, extraerIpDelCliente, opcionesConContexto } = evaluar(fuente);

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
// 2-bis. opcionesConContexto: la fusion de cabeceras
// ---------------------------------------------------------------------------
// Lo explicito del llamador tiene que ganar al contexto deducido.
//
// OJO CON EL ARGUMENTO, QUE ES FACIL EXAGERARLO: el `Authorization` que pasan
// 24 de las 49 funciones en alcance no corre peligro con ninguno de los dos
// ordenes, porque `cabecerasDeContexto()` nunca escribe `Authorization`. Se
// comprueba igual, pero el aserto que de verdad detecta una inversion de orden
// es el de `x-forwarded-for` — probado invirtiendo el spread a proposito: el
// de Authorization seguia pasando y el de x-forwarded-for fallo.
const peticion = pedir({
  'cf-connecting-ip': '9.9.9.9',
  'user-agent': 'NavegadorDePrueba/1.0',
  'x-correlation-id': '11111111-2222-3333-4444-555555555555',
});

const opciones = opcionesConContexto(peticion, {
  auth: { persistSession: false },
  global: { headers: { Authorization: 'Bearer el-jwt-del-llamador' } },
});

const cab = opciones.global.headers;
assert.equal(cab.Authorization, 'Bearer el-jwt-del-llamador',
  'el Authorization del llamador no se puede perder');
assert.equal(cab['x-forwarded-for'], '9.9.9.9', 'se reenvia la IP del cliente');
assert.equal(cab['user-agent'], 'NavegadorDePrueba/1.0', 'se reenvia el user agent');
assert.equal(cab['x-correlation-id'], '11111111-2222-3333-4444-555555555555',
  'se propaga la correlacion que trae el cliente');

// Las demas opciones sobreviven; no se pierde nada por el camino.
assert.equal(opciones.auth.persistSession, false, 'las opciones ajenas se conservan');

// Y si el llamador manda su propio x-forwarded-for, gana el suyo.
assert.equal(
  opcionesConContexto(peticion, { global: { headers: { 'x-forwarded-for': '203.0.113.7' } } })
    .global.headers['x-forwarded-for'],
  '203.0.113.7', 'lo explicito gana tambien para x-forwarded-for');

// Sin opciones: funciona igual y no revienta.
assert.equal(
  opcionesConContexto(peticion).global.headers['x-forwarded-for'],
  '9.9.9.9', 'sin opciones tambien reenvia contexto');

// Una peticion sin cabeceras no debe inventar IP ni user agent. Un origen
// inventado es peor que ninguno.
const cabVacia = opcionesConContexto(pedir({})).global.headers;
assert.equal(cabVacia['x-forwarded-for'], undefined, 'sin IP no se inventa IP');
assert.equal(cabVacia['user-agent'], undefined, 'sin user agent no se inventa');
assert.match(cabVacia['x-correlation-id'], /^[0-9a-f-]{36}$/,
  'sin correlacion se abre una nueva para la peticion');

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
  `${migracion}, mas 5 casos de precedencia de cabeceras y 11 de fusion de cliente.`,
);
if (paridadEjecutada > 0) {
  console.log(`Paridad TypeScript <-> SQL EJECUTADA contra Postgres: ${paridadEjecutada} casos iguales.`);
} else {
  console.log(`Paridad ejecutada OMITIDA (sin Postgres): ${motivoSalto}`);
  console.log('La comprobacion estatica si corrio. En CI hay Postgres y corren las dos.');
}
