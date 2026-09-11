#!/usr/bin/env node
/**
 * El panel puede dar de alta contadores, y los permisos contables se guardan.
 *
 * ============================================================================
 * EL HUECO QUE ESTO CUBRE, MEDIDO
 * ============================================================================
 *
 * Axel fue a darle acceso a su contadora y no encontro donde. Eran TRES cosas
 * distintas, no una:
 *
 *   1. `create-admin-user` tenia el rol QUEMADO: `role: 'admin'` en las dos
 *      inserciones (metadata de auth y tabla `users`). No habia forma de crear
 *      un contador desde el panel, solo por SQL.
 *
 *   2. `AdminUsers.tsx` listaba con `.eq('role', 'admin')`. Aunque existiera un
 *      contador en la base, no aparecia en la pantalla y no se le podian editar
 *      permisos.
 *
 *   3. `can_view_accounting`, `can_export_sat_xml` y `can_manage_chart_of_accounts`
 *      existen en `admin_permissions` desde el 16-may-2026 y el codigo las lee,
 *      pero NUNCA se les puso casilla. Se podian conceder solo por SQL.
 *
 * Y el rol `accountant` no era nuevo: ProtectedRoute ya lo manda a /accounting,
 * AuthContext ya le arma sus permisos, y /accounting y /admin/gastos ya lo
 * aceptan. Lo unico que faltaba era poder crearlo.
 *
 * ============================================================================
 * LA TRAMPA DEL CASO 4, QUE ES POR LO QUE ESTE ARCHIVO VALE LA PENA
 * ============================================================================
 *
 * Un permiso viaja por CUATRO sitios y los cuatro tienen que moverse juntos:
 * el `select` que lo trae, el mapeo que lo convierte a camelCase, la `base` del
 * editor, y el `upsert` que lo escribe.
 *
 * Agregar solo el upsert es PEOR que no tocar nada. El editor arma su estado
 * con `{ ...base, ...user.permissions }`: si el `select` no pide la columna,
 * llega `undefined`, gana el `false` de `base`, la casilla se pinta apagada
 * aunque el permiso este puesto, y al guardar se APAGA. Un permiso que se
 * borra solo al abrir y cerrar una pantalla no avisa de nada.
 *
 * El caso 4 exige los cuatro sitios a la vez, para que nadie pueda agregar el
 * siguiente permiso a medias.
 *
 *   node scripts/test-alta-de-contadores.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const edge = readFileSync('supabase/functions/create-admin-user/index.ts', 'utf8');
const tsx  = readFileSync('src/pages/admin/AdminUsers.tsx', 'utf8');

/**
 * Los asertos NEGATIVOS ("esto ya no debe estar") miran el codigo sin
 * comentarios. La primera version no lo hacia y fallaba contra el comentario
 * que explica el filtro viejo: la prueba leia la explicacion del arreglo como
 * si fuera el bug. Un aserto negativo que se dispara con una linea de prosa
 * obliga a no escribir prosa, que es exactamente al reves de lo que se quiere.
 */
const sinComentarios = (fuente) =>
  fuente.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const edgeCodigo = sinComentarios(edge);
const tsxCodigo  = sinComentarios(tsx);

const casos = [];

// --- 1. El rol se puede pedir, pero solo de una lista blanca ---------------
casos.push(() => {
  assert.ok(/ROLES_QUE_SE_PUEDEN_CREAR = \['admin', 'accountant'\]/.test(edge),
    'debe existir la lista blanca de roles creables');
  assert.ok(/!esRolCreable\(rol\)/.test(edge),
    'el rol de la peticion debe validarse contra la lista blanca');
  // Y con un type guard, no con un `as`: castear antes de validar compila
  // igual y deja la guardia de adorno, porque el tipo afirma algo que todavia
  // no se comprobo.
  assert.ok(/valor is RolCreable/.test(edge),
    'la validacion del rol debe estrechar el tipo, no darlo por hecho con un cast');
  assert.ok(!/\?\? 'admin'\) as RolCreable/.test(edge),
    'quedo el cast a RolCreable antes de validar');
  // El rol llega en el cuerpo. Sin validarlo, un super admin podria teclear
  // 'agency' y colarse a otra agencia, o un valor inexistente y dejar al
  // usuario sin ruta de aterrizaje.
  assert.ok(/status: 400/.test(edge.slice(edge.indexOf('if (!esRolCreable(rol))'))),
    'un rol fuera de la lista debe rechazarse con 400');
});

// --- 2. is_super_admin NUNCA sale de la peticion ---------------------------
casos.push(() => {
  assert.ok(/is_super_admin: false/.test(edge),
    'is_super_admin debe escribirse false a mano');
  assert.ok(!/is_super_admin: (requestData|permissions|body)/.test(edgeCodigo),
    'is_super_admin no puede tomarse del cuerpo de la peticion: seria escalada de privilegios');
});

// --- 3. El rol ya no esta quemado -----------------------------------------
casos.push(() => {
  // Los dos sitios: metadata de auth y la fila de `users`.
  assert.ok(/user_metadata: \{\s*role: rol,/.test(edge),
    'el metadata de auth debe usar el rol pedido, no "admin" quemado');
  assert.ok(/\n {8}role: rol,/.test(edge),
    'la fila de users debe usar el rol pedido');
  assert.ok(!/role: 'admin',\n {8}is_super_admin/.test(edgeCodigo),
    'quedo un role: admin quemado en la insercion de users');
});

// --- 4. LA TRAMPA: un permiso viaja por cuatro sitios ----------------------
casos.push(() => {
  const sitios = [
    // [nombre, patron en el select, patron en el mapeo, en la base, en el upsert]
    ['ver contabilidad',      'can_view_accounting',           /canViewAccounting: permsData\.can_view_accounting/,           /canViewAccounting: false,/,        /can_view_accounting: tempPermissions\.canViewAccounting/],
    ['exportar XML del SAT',  'can_export_sat_xml',            /canExportSatXml: permsData\.can_export_sat_xml/,              /canExportSatXml: false,/,          /can_export_sat_xml: tempPermissions\.canExportSatXml/],
    ['catalogo de cuentas',   'can_manage_chart_of_accounts',  /canManageChartOfAccounts: permsData\.can_manage_chart_of_accounts/, /canManageChartOfAccounts: false,/, /can_manage_chart_of_accounts: tempPermissions\.canManageChartOfAccounts/],
    ['capturar gastos',       'can_manage_expenses',           /canManageExpenses: permsData\.can_manage_expenses/,           /canManageExpenses: false,/,        /can_manage_expenses: tempPermissions\.canManageExpenses/],
  ];

  // El `select` de admin_permissions, aislado para no confundirlo con otros.
  const select = tsx.match(/\.select\('can_manage_agencies[^']*'\)/)?.[0] ?? '';
  assert.ok(select, 'no se encontro el select de admin_permissions');

  // Y la BASE se recorta al literal de `PERMISOS_EN_CERO`. La primera version
  // buscaba `canViewAccounting: false,` en todo el archivo y por eso una
  // mutacion que la borraba de la base SOBREVIVIA: el mismo texto aparecia en
  // el estado inicial, en el reset de cancelar y en la base de
  // startEditPermissions. Un patron que puede acertar en tres sitios no afirma
  // nada sobre ninguno. Desde el 11-sep-2026 esos tres sitios son UNO —la
  // constante—, que es donde se mira ahora; y se comprueba ademas que
  // startEditPermissions siga partiendo de ella, porque si alguien le vuelve a
  // escribir una lista propia, la constante quedaria correcta y sin efecto.
  const inicio = tsx.indexOf('const PERMISOS_EN_CERO');
  assert.ok(inicio > 0, 'no se encontro PERMISOS_EN_CERO en AdminUsers');
  const base_ = tsx.slice(inicio, tsx.indexOf('};', inicio));
  assert.ok(/const base = PERMISOS_EN_CERO;/.test(tsx),
    'startEditPermissions ya no parte de PERMISOS_EN_CERO: la constante quedo sin efecto');

  for (const [nombre, columna, mapeo, base, upsert] of sitios) {
    assert.ok(select.includes(columna),
      `"${nombre}": falta ${columna} en el SELECT. Sin eso el editor la ve apagada y guardar la borra.`);
    assert.ok(mapeo.test(tsx), `"${nombre}": falta en el MAPEO a camelCase.`);
    assert.ok(base.test(base_), `"${nombre}": falta en la BASE de startEditPermissions.`);
    assert.ok(upsert.test(tsx), `"${nombre}": falta en el UPSERT, asi que marcar la casilla no hace nada.`);
  }
});

// --- 5. La lista muestra contadores ----------------------------------------
casos.push(() => {
  assert.ok(/\.in\('role', \['admin', 'accountant'\]\)/.test(tsx),
    'la lista de usuarios debe traer admins Y contadores');
  assert.ok(!/\.eq\('role', 'admin'\)/.test(tsxCodigo),
    'el filtro viejo dejaba a los contadores invisibles en el panel');
});

// --- 6. El alta manda el rol y los permisos contables ----------------------
casos.push(() => {
  assert.ok(/rol: newUser\.rol,/.test(tsx), 'el alta debe mandar el rol elegido');
  assert.ok(/value=\{newUser\.rol\}/.test(tsx), 'debe haber un selector de rol en el alta');
  assert.ok(/<option value="accountant">/.test(tsx), 'el selector debe ofrecer Contador');
  for (const columna of ['can_view_accounting', 'can_export_sat_xml',
                         'can_manage_chart_of_accounts', 'can_manage_expenses']) {
    assert.ok(new RegExp(`${columna}: newUser\\.permissions\\.`).test(tsx),
      `el alta debe mandar ${columna}: si no, el usuario nace sin el y hay que entrar a editarlo`);
  }
});

// --- 7. Un permiso que no se pide, no se concede ---------------------------
casos.push(() => {
  // `?? false` y no `?? true`. Vale para todos, pero sobre todo para los
  // contables, que dan acceso de ESCRITURA a la contabilidad.
  for (const columna of ['can_view_accounting', 'can_export_sat_xml',
                         'can_manage_chart_of_accounts', 'can_manage_expenses']) {
    const re = new RegExp(`${columna}: permissions\\.${columna} \\?\\? false`);
    assert.ok(re.test(edge), `${columna} debe caer en false cuando el llamador no lo manda`);
  }
  assert.ok(!/permissions\.can_\w+ \?\? true/.test(edgeCodigo),
    'ningun permiso puede concederse por omision');
});

// --- 8. A un contador no se le ofrecen permisos que no puede usar ----------
casos.push(() => {
  // Un contador solo llega a /accounting y /admin/gastos. Ofrecerle "Gestionar
  // Agencias" seria mentirle: se guardaria y no haria nada.
  assert.ok(/newUser\.rol === 'admin' \? \(/.test(tsx),
    'los permisos de operacion deben mostrarse solo cuando el rol es admin');
  assert.ok(/no llega a esas pantallas/.test(tsx),
    'hay que decir por que no se ofrecen, no solo esconderlos');
});

let ok = 0;
for (const caso of casos) { caso(); ok++; }
console.log(`Alta de contadores y permisos contables: ${ok}/${casos.length} casos OK`);
