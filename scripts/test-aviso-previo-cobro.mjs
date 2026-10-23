// Contratos del aviso por correo ANTES de que empiece el cobro de las notificaciones (migracion 20261023064502 +
// send-aviso-cobro-notificaciones + la seccion del admin). Lo que se afirma es lo que NO puede romperse sin que se mande un
// correo masivo equivocado o repetido:
//   1. solo avisa quien perderia algo, calculado como si el cobro YA estuviera vigente (la cobertura real dice «gratis» antes);
//   2. quien ya lo recibio para ESA fecha no lo recibe otra vez, y dos llamadas a la vez no lo duplican (se reserva ANTES de mandar);
//   3. solo un administrador, y por omision solo SIMULA: mandar es una decision explicita y confirmada;
//   4. no se avisa de un cobro que no esta programado, ni que ya empezo, ni sin precio;
//   5. el codigo de verificacion (OTP) no entra.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('--') && !l.trim().startsWith('*')).join('\n');

const sql = leer('supabase/migrations/20261023064502_aviso_previo_cobro_notificaciones.sql');
const codigoSql = sinComentarios(sql);
const fn = sinComentarios(leer('supabase/functions/send-aviso-cobro-notificaciones/index.ts'));
const ui = sinComentarios(leer('src/components/CobroNotificacionesSection.tsx'));
const plantilla = sinComentarios(leer('supabase/functions/_shared/avisoCobroNotificaciones.ts'));

let casos = 0;
const prueba = (nombre, f) => { f(); casos++; };

prueba('quien ya recibio el aviso queda registrado una sola vez por persona y por fecha de inicio, y solo un admin lo ve', () => {
  assert.match(codigoSql, /CONSTRAINT avisos_cobro_notificaciones_unico UNIQUE \(user_id, tipo, fecha_inicio\)/);
  assert.match(codigoSql, /CHECK \(tipo IN \('viajero', 'agencia'\)\)/);
  assert.match(codigoSql, /ALTER TABLE public\.avisos_cobro_notificaciones ENABLE ROW LEVEL SECURITY;/);
  assert.match(codigoSql, /GRANT SELECT ON public\.avisos_cobro_notificaciones TO authenticated;/);
  assert.match(codigoSql, /GRANT SELECT, INSERT, DELETE ON public\.avisos_cobro_notificaciones TO service_role;/);
  const politicas = codigoSql.match(/CREATE POLICY[^;]*;/g) ?? [];
  assert.equal(politicas.length, 1);
  assert.match(politicas[0], /FOR SELECT TO authenticated USING \(public\.is_admin_user\(\)\)/);
});

prueba('la audiencia: solo servicio, SECURITY DEFINER con search_path fijo', () => {
  assert.match(codigoSql, /LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''/);
  assert.match(codigoSql, /REVOKE ALL ON FUNCTION public\.audiencia_aviso_cobro_notificaciones\(\) FROM PUBLIC, anon, authenticated;/);
  assert.match(codigoSql, /GRANT EXECUTE ON FUNCTION public\.audiencia_aviso_cobro_notificaciones\(\) TO service_role;/);
});

prueba('viajero: tiene algun aviso encendido, telefono verificado y activo, y NO estaria cubierto (como si el cobro ya estuviera vigente)', () => {
  const v = codigoSql.slice(codigoSql.indexOf('viajeros AS ('), codigoSql.indexOf('agencias AS ('));
  assert.match(v, /np\.viajero_confirmacion OR np\.viajero_cancelacion OR np\.viajero_recordatorio/);
  assert.match(v, /COALESCE\(u\.is_active, false\) AND u\.phone_verified_at IS NOT NULL/);
  assert.match(v, /messaging_private\.decidir_cobertura\(\s+true,\s+public\.has_active_membership\(u\.id\),/, 'vigente = true y Plus real');
  assert.match(v, /\) IS NULL/, 'solo quien quedaria SIN cobertura');
  assert.match(v, /x\.status IN \('active', 'trialing'\) AND x\.current_period_end \+ interval '1 day' > now\(\)/, 'el mismo margen de un dia de la cobertura');
  assert.match(v, /x\.en_gracia_hasta > now\(\)/);
});

prueba('agencia: el DUENO, si el o su personal ACTIVO tiene avisos de agencia encendidos, y la agencia sin suscripcion (Plus no aplica)', () => {
  const a = codigoSql.slice(codigoSql.indexOf('agencias AS ('), codigoSql.indexOf('todos AS ('));
  assert.match(a, /JOIN public\.users u ON u\.id = a\.user_id/, 'el correo va al dueno');
  assert.match(a, /np\.agencia_reserva OR np\.agencia_cancelacion OR np\.agencia_mensaje/);
  assert.match(a, /st\.agency_id = a\.id AND st\.is_active/);
  assert.match(a, /messaging_private\.decidir_cobertura\(\s+true,\s+false,/, 'Plus no cubre a una agencia');
  assert.match(a, /x\.tipo = 'agencia' AND x\.agency_id = a\.id/);
});

prueba('quien ya recibio el aviso para ESTA fecha no entra, y sin fecha de inicio no hay audiencia', () => {
  assert.match(codigoSql, /WHERE ajustes\.desde IS NOT NULL/);
  assert.match(codigoSql, /NOT EXISTS \(SELECT 1 FROM public\.avisos_cobro_notificaciones v\s+WHERE v\.user_id = t\.user_id AND v\.tipo = t\.tipo AND v\.fecha_inicio = ajustes\.desde\)/);
});

prueba('la funcion: solo admin y por omision SOLO SIMULA', () => {
  assert.match(fn, /requireAdmin\(req, \{ recurso: "send-aviso-cobro-notificaciones", cors \}\)/);
  assert.match(fn, /const modo = cuerpo\?\.modo === "enviar" \? "enviar" : "simular";/);
  assert.match(fn, /if \(modo === "simular"\) return responder\(\{ modo, \.\.\.resumen \}, 200\);/);
  // Nada se manda antes del retorno de la simulacion.
  assert.ok(fn.indexOf('if (modo === "simular")') < fn.indexOf('enviarCorreo('), 'simular retorna antes de mandar');
});

prueba('no se avisa de un cobro que no esta programado, que ya empezo, o sin precio', () => {
  assert.match(fn, /if \(!ajustes\.cobro_notificaciones_activo\) throw new ErrorDeNegocio/);
  assert.match(fn, /if \(!desde \|\| Number\.isNaN\(desde\.getTime\(\)\)\) throw new ErrorDeNegocio/);
  assert.match(fn, /if \(desde\.getTime\(\) <= Date\.now\(\)\) throw new ErrorDeNegocio/);
  assert.match(fn, /!ajustes\.stripe_price_notificaciones_viajero \|\| !ajustes\.stripe_price_notificaciones_agencia/);
  assert.match(fn, /stripe\.prices\.retrieve\(id\)/, 'el monto sale de Stripe, no se captura dos veces');
});

prueba('se RESERVA la fila antes de mandar (dos llamadas a la vez no duplican) y si no salio se libera para reintentar', () => {
  const reserva = fn.indexOf('.from("avisos_cobro_notificaciones").insert(');
  const envio = fn.indexOf('await enviarCorreo(');
  assert.ok(reserva > -1 && envio > reserva, 'primero se reserva, luego se manda');
  assert.match(fn, /\(errReserva as \{ code\?: string \}\)\.code !== "23505"/);
  assert.match(fn, /if \(errReserva\) \{[\s\S]{0,260}continue;\s+\}/, 'una reserva que choca NO manda');
  assert.match(fn, /fallidos\+\+;[\s\S]{0,260}\.from\("avisos_cobro_notificaciones"\)\.delete\(\)/, 'si no salio, se libera');
});

prueba('se manda con remitente con nombre y texto plano, por tandas acotadas', () => {
  assert.match(fn, /remitente: REMITENTE_AVISO/);
  assert.match(fn, /texto: aviso\.texto/);
  assert.match(fn, /const TOPE_POR_LLAMADA = 200;/);
  assert.match(fn, /destinatarios\.slice\(0, TOPE_POR_LLAMADA\)/);
  assert.match(plantilla, /export const REMITENTE_AVISO = "ToursRed <contacto@toursred\.com>";/);
});

prueba('la pantalla: el aviso solo se habilita con el cobro encendido, fecha a futuro y precios; y mandar pide confirmacion', () => {
  assert.match(ui, /guardado\?\.cobro_notificaciones_activo && fechaGuardada && fechaGuardada\.getTime\(\) > ahora/);
  assert.match(ui, /guardado\.stripe_price_notificaciones_viajero && guardado\.stripe_price_notificaciones_agencia/);
  assert.match(ui, /invocarSuscripcion<ResumenAviso>\('send-aviso-cobro-notificaciones', \{ modo: 'simular' \}\)/);
  // El bloque de enviarAviso (la pantalla ya tiene OTRA confirmacion, la de encender el cobro: no se confunden).
  const bloque = ui.slice(ui.indexOf('const enviarAviso = useMutation('), ui.indexOf('if (ajustes.isPending)'));
  assert.ok(bloque.length > 100, 'se encontro el bloque');
  assert.match(bloque, /const ok = window\.confirm\(/);
  assert.match(bloque, /if \(!ok\) throw new Error\('Cancelado: no se envió ningún correo\.'\);/, 'sin confirmar no se manda');
  assert.ok(bloque.indexOf('window.confirm(') < bloque.indexOf("{ modo: 'enviar' }"), 'se confirma ANTES de mandar');
  assert.match(ui, /disabled=\{!avisoDisponible \|\| !resumenAviso \|\| resumenAviso\.por_avisar === 0 \|\| enviarAviso\.isPending\}/);
});

prueba('el codigo de verificacion (OTP) no entra a nada de esto', () => {
  for (const f of [codigoSql, fn, plantilla]) assert.ok(!/\botp\b/i.test(f), 'sin OTP en codigo');
});

console.log(`OK: ${casos} casos del aviso previo al cobro de notificaciones.`);
