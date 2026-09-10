/**
 * El contrato entre la vista y la pantalla del reporte maestro.
 *
 * ============================================================================
 * QUE FALLO CUBRE
 * ============================================================================
 *
 * `AdminReporteMaestro.tsx` lee 13 columnas de
 * `vista_movimientos_financieros` por nombre. Si alguien renombra una en la
 * migracion —o agrega un bloque al UNION con un alias distinto— el front
 * recibe `undefined`, lo pasa por `Number(f.caja ?? 0)` y pinta CERO.
 *
 * Ese es el peor modo de fallo posible para un reporte financiero: no hay
 * error, no hay pantalla roja, no hay nada en Sentry. Solo un numero mas
 * chico. Es la misma familia del bug que motivo toda esta reescritura, donde
 * `platform_revenue` traia menos de lo que el nombre sugeria y el reporte
 * mostraba $335 en vez de $1,162.50.
 *
 * Por eso el contrato se comprueba en CI y no a ojo.
 *
 *   node scripts/test-reporte-maestro-contrato.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MIGRACION = 'supabase/migrations/20260910080000_vista_movimientos_financieros.sql';
const PANTALLA  = 'src/pages/admin/AdminReporteMaestro.tsx';

const sql = readFileSync(MIGRACION, 'utf8');
const tsx = readFileSync(PANTALLA, 'utf8');

const casos = [];

/** Los alias del PRIMER SELECT del UNION: en Postgres son los que nombran a
 *  todas las columnas de la vista, sin importar como se llamen en los demas. */
const columnasDeLaVista = () => {
  const ini = sql.indexOf('-- 1. Cobros por pasarela');
  assert.notEqual(ini, -1, 'no se encontro el primer bloque del UNION');
  const fin = sql.indexOf('UNION ALL', ini);
  const primerSelect = sql.slice(ini, fin);
  const cols = [...primerSelect.matchAll(/\bAS\s+([a-z_]+)\b/g)].map((m) => m[1]);
  assert.ok(cols.length >= 10, `solo se extrajeron ${cols.length} alias del primer SELECT`);
  return cols;
};

/** Lo que la pantalla lee del resultado, dentro del `.map` que arma las filas. */
const columnasQueLeeElFront = () => {
  const ini = tsx.indexOf('(data ?? []).map');
  assert.notEqual(ini, -1, 'no se encontro el mapeo de filas en la pantalla');
  const fin = tsx.indexOf('})),', ini);
  assert.notEqual(fin, -1, 'no se encontro el cierre del mapeo');
  const bloque = tsx.slice(ini, fin);
  return [...new Set([...bloque.matchAll(/\bf\.([a-z_]+)/g)].map((m) => m[1]))];
};

// --- 1. Todo lo que el front lee, la vista lo produce -----------------------
casos.push(() => {
  const vista = new Set(columnasDeLaVista());
  const faltan = columnasQueLeeElFront().filter((c) => !vista.has(c));
  assert.deepEqual(faltan, [],
    `la pantalla lee columnas que la vista NO produce: ${faltan.join(', ')}. ` +
    'El front las leeria como undefined y las pintaria como cero, sin error.');
});

// --- 2. Las cuatro capas estan, y con ese nombre ----------------------------
casos.push(() => {
  const vista = new Set(columnasDeLaVista());
  for (const capa of ['caja', 'pasivo', 'ingreso', 'traspaso']) {
    assert.ok(vista.has(capa), `la vista perdio la columna '${capa}'`);
  }
});

// --- 3. La pantalla consulta la vista, no las tablas de nuevo ---------------
casos.push(() => {
  assert.ok(tsx.includes("from('vista_movimientos_financieros')"),
    'la pantalla debe consultar la vista');
  // La reescritura existe para que el front deje de sumar por su cuenta. Si
  // vuelven a aparecer consultas directas a las tablas de dinero, volvimos al
  // problema original: dos lugares con la regla, y uno se queda atras.
  const prohibidas = ['bookings', 'commission_records', 'payment_transactions',
                      'agency_payouts', 'cancellation_penalty_records'];
  const reincidentes = prohibidas.filter((t) => tsx.includes(`from('${t}')`));
  assert.deepEqual(reincidentes, [],
    `la pantalla volvio a consultar tablas directamente: ${reincidentes.join(', ')}`);
});

// --- 4. El error de la consulta no se traga ---------------------------------
casos.push(() => {
  // Un reporte financiero vacio por error es indistinguible de un periodo sin
  // actividad. Es el hallazgo F-1 de la auditoria, cuya linea base es CERO.
  assert.ok(/if\s*\(errorConsulta\)\s*throw\s+errorConsulta/.test(tsx),
    'la consulta debe lanzar si falla, no dejar la tabla vacia en silencio');
});

// --- 5. Una fecha a medio escribir no dispara la consulta -------------------
casos.push(() => {
  // `<input type="date">` pasa por '' mientras se edita, y PostgREST responde
  // 400 a `fecha=gte.` sin valor. Salio en la primera prueba real de la
  // pantalla: banner rojo de error con la tabla llena de datos correctos.
  assert.ok(/if\s*\(!filtros\.desde\s*\|\|\s*!filtros\.hasta\)\s*return/.test(tsx),
    'la carga debe salirse si alguna fecha esta vacia, o PostgREST devuelve 400');
});

// --- 6. Dos cargas encimadas no se pisan -----------------------------------
casos.push(() => {
  // Sin secuenciar, la peticion que termina al final gana aunque sea la vieja.
  // Eso dejo la pantalla con 185 filas Y el banner de error a la vez.
  assert.ok(/peticionActual/.test(tsx),
    'debe haber un contador de peticiones que descarte las respuestas que llegan tarde');
  assert.ok((tsx.match(/miTurno !== peticionActual\.current/g) || []).length >= 2,
    'tanto el camino bueno como el de error deben descartar una respuesta tardia');
});

// --- 7. Las columnas se llaman como el catalogo de cuentas -----------------
casos.push(() => {
  // "Caja" es una cuenta concreta; la columna es el movimiento de bancos, que
  // en el catalogo es activo. Lo pidio Axel al no entender el reporte.
  assert.ok(/'Activo \(bancos\)'/.test(tsx), "la tarjeta debe decir 'Activo (bancos)', no 'Caja'");
  assert.ok(!/>Caja</.test(tsx), "la columna de la tabla no debe seguir llamandose 'Caja'");
});

// --- 5. El aviso de los gastos de operacion sigue en pantalla ---------------
casos.push(() => {
  // Un hueco conocido que no se anuncia se lee como un cero, y un cero en
  // gastos de operacion es una mentira comoda.
  assert.ok(/gastos de operacion no estan incluidos/i.test(tsx),
    'debe seguir el aviso de que los gastos de operacion no se capturan todavia');
});

let ok = 0;
for (const caso of casos) { caso(); ok++; }
console.log(`Contrato vista <-> reporte maestro: ${ok}/${casos.length} casos OK`);
