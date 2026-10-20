#!/usr/bin/env node
// Pantalla «Bitácora de correo» del admin (20-oct-2026).
//
// Muestra `bitacora_envio_correo` (un intento de envío por fila) y `bitacora_evento_correo` (lo que Zoho avisa
// después) para responder «¿por qué proveedor salió este correo y qué pasó con él?» sin abrir la base.
//
//   1. La lógica, EJECUTADA (src/lib/bitacoraCorreo.ts): estado de entrega, etiquetas y traducción de los filtros.
//   2. Contratos de la pantalla, la ruta y el menú: solo lee, pagina, ordena por fecha, no pide el cuerpo, está
//      protegida y solo la ve quien puede configurar.
//
// No prueba la pantalla en un navegador ni contra la base (la lectura depende de la RLS de admin).
//
//   node scripts/test-bitacora-correo-admin.mjs   (Node 24; en 22 agrega --experimental-strip-types)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const m = await import('../src/lib/bitacoraCorreo.ts');

let casos = 0;
const prueba = (nombre, fn) => {
  try { fn(); casos++; } catch (e) { console.error(`FALLA: ${nombre}`); throw e; }
};
const sinComentarios = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((l) => !/^\s*\/\//.test(l))
  .map((l) => l.replace(/\s\/\/.*$/, ''))
  .join('\n');
const fuente = (f) => sinComentarios(readFileSync(f, 'utf8'));

// Constructor de consultas falso: apunta cada llamada.
const consultaFalsa = () => {
  const llamadas = [];
  const q = new Proxy({}, { get: (_, metodo) => (...args) => { llamadas.push([metodo, ...args]); return q; } });
  return { q, llamadas };
};

prueba('estadoDeEntrega: lo peor que se sepa manda, y «aceptado» no es «entregado»', () => {
  const e = (aceptado, tipos) => m.estadoDeEntrega(aceptado, tipos).clave;
  assert.equal(e(false, ['delivered']), 'no_aceptado', 'si no lo aceptaron, ningun evento cambia eso');
  assert.equal(e(true, []), 'aceptado', 'sin eventos solo se sabe que el proveedor lo acepto');
  assert.equal(e(true, ['delivered']), 'entregado');
  assert.equal(e(true, ['delivered', 'email_open']), 'abierto', 'abierto implica entregado');
  assert.equal(e(true, ['delivered', 'email_link_click']), 'abierto');
  assert.equal(e(true, ['delivered', 'softbounce']), 'rebote_suave');
  assert.equal(e(true, ['delivered', 'email_open', 'hardbounce']), 'rebote_duro', 'un rebote duro pesa mas que haberlo abierto');
  assert.equal(e(true, ['delivered', 'feedback_loop']), 'spam');
  assert.equal(e(true, ['softbounce', 'hardbounce']), 'rebote_duro');
  assert.equal(e(true, ['evento-raro']), 'aceptado', 'un tipo desconocido no inventa un estado');
});

prueba('estadoDeEntrega: tono por estado (rojo para lo que requiere atencion)', () => {
  const tono = (aceptado, tipos) => m.estadoDeEntrega(aceptado, tipos).tono;
  assert.equal(tono(false, []), 'rojo');
  assert.equal(tono(true, ['hardbounce']), 'rojo');
  assert.equal(tono(true, ['softbounce']), 'amarillo');
  assert.equal(tono(true, ['delivered']), 'verde');
  assert.equal(tono(true, ['email_open']), 'azul');
  assert.equal(tono(true, []), 'gris');
});

prueba('etiquetas: proveedor, clase de fallo y evento; lo desconocido se muestra tal cual', () => {
  assert.equal(m.etiquetaProveedor('zoho'), 'Zoho Mail');
  assert.equal(m.etiquetaProveedor('sendgrid'), 'SendGrid');
  assert.equal(m.etiquetaProveedor('otro'), 'otro');
  assert.equal(m.etiquetaClase('rechazo_confirmado'), 'El proveedor lo rechazó');
  assert.equal(m.etiquetaClase(null), '');
  assert.equal(m.etiquetaClase('rara'), 'rara');
  assert.equal(m.etiquetaEvento('delivered'), 'Entregado');
  assert.equal(m.etiquetaEvento('hardbounce'), 'Rebote permanente');
  assert.equal(m.etiquetaEvento('x'), 'x');
});

prueba('aplicarFiltros: sin filtros no agrega nada', () => {
  const { q, llamadas } = consultaFalsa();
  m.aplicarFiltros(q, m.FILTROS_VACIOS);
  assert.deepEqual(llamadas, []);
});

prueba('aplicarFiltros: cada filtro llega a la consulta con el operador correcto', () => {
  const { q, llamadas } = consultaFalsa();
  m.aplicarFiltros(q, {
    destinatario: '  Ana@Ejemplo.COM ', asunto: ' Reserva ', proveedor: 'zoho', estado: 'rechazado', soloRespaldo: true, desde: '2026-10-19', hasta: '2026-10-20',
  });
  assert.deepEqual(llamadas, [
    ['contains', 'destinatarios', ['ana@ejemplo.com']],
    ['ilike', 'asunto', '%Reserva%'],
    ['eq', 'proveedor', 'zoho'],
    ['eq', 'aceptado', false],
    ['eq', 'es_respaldo', true],
    ['gte', 'creado_en', new Date('2026-10-19T00:00:00').toISOString()],
    ['lte', 'creado_en', new Date('2026-10-20T23:59:59.999').toISOString()],
  ]);
  const aceptados = consultaFalsa();
  m.aplicarFiltros(aceptados.q, { ...m.FILTROS_VACIOS, estado: 'aceptado' });
  assert.deepEqual(aceptados.llamadas, [['eq', 'aceptado', true]]);
});

prueba('escaparLike: «100%», «a_b» y la barra se buscan como texto, no como comodines', () => {
  assert.equal(m.escaparLike('100%'), '100\\%');
  assert.equal(m.escaparLike('a_b'), 'a\\_b');
  assert.equal(m.escaparLike('a\\b'), 'a\\\\b');
  const { q, llamadas } = consultaFalsa();
  m.aplicarFiltros(q, { ...m.FILTROS_VACIOS, asunto: '50%_off' });
  assert.deepEqual(llamadas, [['ilike', 'asunto', '%50\\%\\_off%']]);
});

prueba('un dia completo: del primer al ultimo instante local', () => {
  const ini = new Date(m.inicioDelDia('2026-10-20'));
  const fin = new Date(m.finDelDia('2026-10-20'));
  assert.equal(ini.getHours() + ini.getMinutes() + ini.getSeconds(), 0);
  assert.equal(fin.getHours(), 23);
  assert.equal(fin.getMinutes(), 59);
  assert.ok(fin.getTime() - ini.getTime() >= 24 * 3600 * 1000 - 1 && fin.getTime() - ini.getTime() < 24 * 3600 * 1000 + 3600 * 1000);
});

prueba('contarFiltrosActivos: ignora espacios y cuenta cada filtro puesto', () => {
  assert.equal(m.contarFiltrosActivos(m.FILTROS_VACIOS), 0);
  assert.equal(m.contarFiltrosActivos({ ...m.FILTROS_VACIOS, destinatario: '   ' }), 0);
  assert.equal(m.contarFiltrosActivos({ ...m.FILTROS_VACIOS, destinatario: 'a@b.com', soloRespaldo: true, proveedor: 'zoho' }), 3);
});

prueba('la pantalla solo LEE, ordena por fecha, pagina y no pide un cuerpo que no existe', () => {
  const p = fuente('src/pages/admin/AdminBitacoraCorreo.tsx');
  assert.doesNotMatch(p, /\.(insert|update|upsert|delete)\(/, 'es de consulta: no escribe');
  assert.match(p, /from\('bitacora_envio_correo'\)\.select\('\*', \{ count: 'exact' \}\)/);
  assert.match(p, /\.order\('creado_en', \{ ascending: false \}\)/);
  assert.match(p, /\.range\(pagina \* TAMANO_PAGINA, pagina \* TAMANO_PAGINA \+ TAMANO_PAGINA - 1\)/);
  assert.match(p, /\.in\('referencia', envios\.map\(\(e\) => e\.id\)\)/, 'los eventos se piden solo de los envios de la pagina');
  assert.match(p, /aplicarFiltros\(/);
  assert.doesNotMatch(p, /select\([^)]*(html|cuerpo|html_body|htmlbody|body)/i, 'no se pide ninguna columna de cuerpo (no existe)');
  // el resumen de 24 h usa conteos sin traer filas
  assert.equal((p.match(/\{ count: 'exact', head: true \}/g) ?? []).length, 4);
});

prueba('la pantalla muestra todos los intentos de un envio y los eventos de ESE intento', () => {
  const p = fuente('src/pages/admin/AdminBitacoraCorreo.tsx');
  assert.match(p, /\.eq\('envio_id', envio\.envio_id\)/);
  assert.match(p, /\.eq\('referencia', envio\.id\)/);
  assert.match(p, /estadoDeEntrega\(envio\.aceptado, data\?\.tiposPorEnvio\.get\(envio\.id\) \?\? \[\]\)/);
});

prueba('la pantalla, la ruta y el menu estan protegidos y solo los ve quien puede configurar', () => {
  const p = fuente('src/pages/admin/AdminBitacoraCorreo.tsx');
  assert.match(p, /const puedeVer = isSuperAdmin \|\| permissions\?\.canManageSettings/);
  assert.equal((p.match(/enabled: Boolean\(puedeVer\)/g) ?? []).length, 2, 'sin permiso no se lanza NINGUNA consulta: ni la tabla ni el resumen');
  assert.match(p, /if \(!puedeVer\) \{[\s\S]*?Acceso Denegado/);
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /path="\/admin\/bitacora-correo"\s+element=\{\s*<ProtectedRoute allowedRoles=\{\[UserRole\.ADMIN\]\}>\s*<AdminBitacoraCorreo \/>/);
  const nav = readFileSync('src/components/NavBar.tsx', 'utf8');
  assert.match(nav, /if \(isSuperAdmin \|\| permissions\?\.canManageSettings\) \{\s*comunicacionesItems\.push\(\{ to: '\/admin\/bitacora-correo'/);
});

console.log(`OK: ${casos} casos de la pantalla de bitacora de correo.`);
