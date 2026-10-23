// Contratos de la migracion 20261023052207: SMS al VIAJERO por tipo (confirmacion, cancelacion, recordatorio) y el aviso de cancelacion.
// Lo que se afirma aqui es lo que NO puede romperse sin que se mande un SMS que el viajero no pidio, se mande a quien ya no esta cubierto,
// o el reinicio del cobro deje encendidos avisos que debio apagar:
//   1. cada aviso mira SU preferencia, al encolar y justo antes de enviar, y respeta la cobertura del cobro;
//   2. un aviso nuevo (la cancelacion) nace apagado: no se activa solo a quien ya tenia el interruptor de antes;
//   3. cancelar encola el aviso solo desde una reserva CONFIRMADA, y limpiar lo pendiente no se lleva el aviso mismo;
//   4. el reinicio del cobro apaga y respalda las preferencias NUEVAS (la fase 1 solo conocia transactional_enabled);
//   5. la seccion del perfil solo sale con cobertura, y el codigo de verificacion (OTP) no entra.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = (ruta) => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('--') && !l.trim().startsWith('*')).join('\n');

const sql = leer('supabase/migrations/20261023052207_sms_viajero_preferencias_por_tipo_y_cancelacion.sql');
const intentos = leer('supabase/migrations/20261023055536_sms_cancelacion_viajero_categoria_en_intentos.sql');
const codigoSql = sinComentarios(sql);
const pantalla = leer('src/components/SmsPreferences.tsx');
const plantillas = leer('supabase/functions/_shared/mensajeria/plantillas.ts');

let casos = 0;
const prueba = (nombre, fn) => { fn(); casos++; };

const cuerpoDe = (firma) => {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${firma}`);
  assert.ok(i > -1, `no esta la funcion ${firma}`);
  return sinComentarios(sql.slice(i, sql.indexOf('$function$;', sql.indexOf('AS $function$', i) + 13)));
};

prueba('las tres preferencias nacen apagadas; quien ya tenia el interruptor conserva confirmacion y recordatorio, NO la cancelacion', () => {
  for (const c of ['viajero_confirmacion', 'viajero_cancelacion', 'viajero_recordatorio']) {
    assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\s+boolean NOT NULL DEFAULT false`));
  }
  const relleno = sql.slice(sql.indexOf('UPDATE messaging_private.notification_preferences'), sql.indexOf('-- 2. La categoria nueva'));
  assert.match(relleno, /SET viajero_confirmacion = transactional_enabled,\s+viajero_recordatorio = transactional_enabled/);
  assert.ok(!/viajero_cancelacion\s*=/.test(relleno), 'un aviso nuevo no se activa solo');
  assert.match(relleno, /AND transactional_enabled;/, 'solo a quien lo tenia encendido');
});

prueba('la categoria nueva entra a la cola exigiendo el fragmento exacto', () => {
  assert.match(sql, /viejo text := '''recordatorio_tour''::text,';/);
  assert.match(sql, /IF veces <> 1 THEN RAISE EXCEPTION 'notification_outbox_category_check cambio/);
  assert.match(sql, /viejo \|\| ' ''reserva_cancelada''::text,'/);
});

prueba('la categoria nueva entra a las DOS tablas que enumeran categorias: la cola y los INTENTOS (sin la segunda el aviso nunca salia)', () => {
  // 23-oct-2026: la cola la conocia y el CHECK de notification_attempts no; begin_sms_attempt fallaba al insertar el intento y el worker
  // (que traga el error a proposito) dejaba el aviso en resultado_desconocido, sin enviar.
  assert.match(sinComentarios(intentos), /notification_attempts_category_check/);
  assert.match(sinComentarios(intentos), /replace\(def, viejo, viejo \|\| ' ''reserva_cancelada''::text,'\)/);
  assert.match(sinComentarios(intentos), /IF veces <> 1 THEN RAISE EXCEPTION 'notification_attempts_category_check cambio/);
  assert.match(sql, /notification_outbox_category_check/);
});

prueba('encolar y despachar miran la preferencia de SU tipo (ya no el interruptor unico), con el fragmento exacto', () => {
  assert.match(sql, /case p_category when ''recordatorio_tour'' then viajero_recordatorio else viajero_confirmacion end\)/, 'encolar');
  assert.match(sql, /case o\.category when ''recordatorio_tour'' then viajero_recordatorio else viajero_confirmacion end\)/, 'despachar');
  for (const f of ['queue_booking_sms cambio', 'prepare_sms_notification cambio \\(preferencia\\)', 'prepare_sms_notification cambio \\(desvio\\)']) {
    assert.match(sql, new RegExp(`'${f}: el fragmento aparece % veces, se esperaba 1'`));
  }
  const reemplazos = codigoSql.split('\n').filter((l) => l.trim().startsWith('nuevo :='));
  assert.ok(reemplazos.length >= 3, 'se encontraron los reemplazos');
  assert.ok(reemplazos.every((l) => !l.includes('transactional_enabled')), 'ya nada decide con el interruptor unico');
});

prueba('la cancelacion se desvia a su funcion ANTES del desvio de la agencia (si no, la tomaria el viajero como aviso de reserva)', () => {
  const desvio = sql.indexOf("nuevo := 'if o.category = ''reserva_cancelada'' then return messaging_private.prepare_traveler_cancel_sms(o); end if;'");
  assert.ok(desvio > -1);
  assert.match(sql.slice(desvio, desvio + 400), /\|\| E'\\n ' \|\| viejo;/, 'se inserta justo antes del desvio de la agencia');
});

prueba('encolar la cancelacion: reserva cancelada, telefono verificado, preferencia propia y cobertura del cobro', () => {
  const f = cuerpoDe('messaging_private.queue_traveler_cancel_sms');
  assert.match(f, /IF NOT s\.sms_habilitado THEN RETURN NULL; END IF;/);
  assert.match(f, /b\.status <> 'cancelled'/);
  assert.match(f, /u\.phone_verified_at IS NULL OR u\.phone_verified_e164 IS NULL THEN RETURN NULL/);
  assert.match(f, /np\.viajero_cancelacion\) THEN\s+RETURN NULL/);
  assert.match(f, /cobertura_notificaciones\('viajero', u\.id, NULL\) IS NULL THEN RETURN NULL/);
  assert.match(f, /'reserva_cancelada:' \|\| b\.id::text/, 'una sola vez por reserva');
  assert.match(f, /SECURITY DEFINER SET search_path TO ''/);
});

prueba('despachar la cancelacion vuelve a comprobar todo, incluido que la reserva sea de ESE usuario', () => {
  const f = cuerpoDe('messaging_private.prepare_traveler_cancel_sms');
  assert.match(f, /u\.phone_verified_e164 IS DISTINCT FROM o\.destination_e164/);
  assert.match(f, /np\.viajero_cancelacion\) THEN\s+RETURN jsonb_build_object\('allowed', false\)/);
  assert.match(f, /cobertura_notificaciones\('viajero', u\.id, NULL\) IS NULL/);
  assert.match(f, /b\.status <> 'cancelled' OR b\.user_id IS DISTINCT FROM u\.id/);
  assert.ok(!/'destination', o\.destination_e164, 'folio', b\.booking_code, 'tour', v_tour, '(monto|total|price)/.test(f), 'sin datos de pago');
  for (const n of ['queue_traveler_cancel_sms(uuid)', 'prepare_traveler_cancel_sms(messaging_private.notification_outbox)']) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION messaging_private.${n} FROM PUBLIC, anon, authenticated;`), n);
  }
});

prueba('el disparador: solo una reserva CONFIRMADA que se cancela avisa, limpiar lo pendiente no se lleva el aviso, y un fallo no deshace nada', () => {
  const f = cuerpoDe('messaging_private.booking_sms_event');
  assert.match(f, /IF OLD\.status = 'confirmed' AND NEW\.status = 'cancelled' THEN\s+PERFORM messaging_private\.queue_traveler_cancel_sms\(NEW\.id\);/);
  assert.match(f, /status = 'pendiente' AND category <> 'reserva_cancelada'/);
  assert.match(f, /PERFORM public\.queue_booking_sms\(NEW\.id, 'reserva_confirmada'\)/, 'la confirmacion sigue igual');
  assert.match(f, /EXCEPTION WHEN others THEN[\s\S]{0,200}messaging_private\.alert\('queue_error'\)[\s\S]{0,80}RETURN NEW;/, 'un fallo de aviso nunca deshace el pago ni la reserva');
});

prueba('el reinicio del cobro apaga y respalda las preferencias NUEVAS, y respalda ANTES de apagar', () => {
  const f = cuerpoDe('public.aplicar_inicio_cobro_notificaciones');
  assert.match(f, /np\.viajero_confirmacion OR np\.viajero_cancelacion OR np\.viajero_recordatorio/, 'las busca');
  assert.match(f, /cobertura_notificaciones\('viajero', r\.user_id, NULL\) IS NULL/, 'quien esta cubierto conserva las suyas');
  const respaldo = f.indexOf('INSERT INTO messaging_private.notification_preferences_respaldo');
  const apagado = f.indexOf('viajero_confirmacion  = CASE WHEN v_viajero THEN false');
  assert.ok(respaldo > -1 && apagado > respaldo, 'respalda primero');
  for (const c of ['viajero_cancelacion   = CASE WHEN v_viajero THEN false', 'viajero_recordatorio  = CASE WHEN v_viajero THEN false']) assert.ok(f.includes(c), c);
  assert.match(sql, /ALTER TABLE messaging_private\.notification_preferences_respaldo\s+ADD COLUMN IF NOT EXISTS viajero_confirmacion boolean/);
  assert.match(f, /IF NOT s\.cobro_notificaciones_activo THEN/, 'apagado: no toca nada');
  assert.match(f, /IF s\.cobro_notificaciones_reseteado_en IS NOT NULL THEN RETURN 0; END IF;/, 'una sola vez');
});

prueba('las RPC del perfil: solo para sesiones, el interruptor viejo sigue funcionando y mueve los tres', () => {
  const set = cuerpoDe('public.set_my_traveler_sms_preferences');
  assert.match(set, /auth\.uid\(\) IS NULL OR p_confirmacion IS NULL OR p_cancelacion IS NULL OR p_recordatorio IS NULL THEN\s+RAISE EXCEPTION 'Sesion requerida'/);
  assert.match(set, /ON CONFLICT \(user_id, application, channel\) DO UPDATE/);
  assert.match(cuerpoDe('public.set_my_sms_preferences'), /set_my_traveler_sms_preferences\(p_enabled, p_enabled, p_enabled\)/);
  assert.match(cuerpoDe('public.get_my_sms_preferences'), /viajero_confirmacion OR np\.viajero_cancelacion OR np\.viajero_recordatorio/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_my_traveler_sms_preferences\(\) FROM PUBLIC, anon;/);
  // Sin comentarios: un REVOKE comentado no cierra nada (patron 4).
  assert.match(codigoSql, /REVOKE ALL ON FUNCTION public\.set_my_traveler_sms_preferences\(boolean, boolean, boolean\) FROM PUBLIC, anon;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.set_my_traveler_sms_preferences\(boolean, boolean, boolean\) TO authenticated, service_role;/);
});

prueba('la seccion del perfil: tres avisos, solo sale con cobertura, y nada de los codigos de verificacion', () => {
  assert.match(pantalla, /if \(cobro\.data && cobro\.data\.cobertura === null\) return null;/);
  for (const t of ['Confirmación de reservas', 'Cancelación de reservas', 'Recordatorios de tours']) assert.ok(pantalla.includes(t), t);
  assert.match(pantalla, /rpc\('get_my_traveler_sms_preferences'\)/);
  assert.match(pantalla, /rpc\('set_my_traveler_sms_preferences'/);
  assert.match(plantillas, /case 'reserva_cancelada': return plantillaCancelacion\(snapshot\.folio, snapshot\.tour, base\);/);
});

prueba('el OTP no aparece en nada de esto: nunca entra a las preferencias ni al cobro', () => {
  assert.ok(!/\botp\b/i.test(codigoSql), 'sin OTP en codigo SQL');
  assert.ok(!/begin_sms_attempt|request-phone-otp|request-login-otp/.test(codigoSql));
});

console.log(`OK: ${casos} casos de las preferencias de SMS del viajero.`);
