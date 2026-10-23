// Contratos de la FASE 1 del cobro de notificaciones (migración 20261023003356): control de acceso y base de datos,
// APAGADO POR DEFECTO. No cobra nada ni cambia el comportamiento actual; lo que se afirma aquí es justo eso:
//   1. el cobro arranca apagado;
//   2. con el cobro apagado la función de cobertura devuelve «gratis» ANTES de consultar nada más;
//   3. los cuatro puntos de control (encolar y despachar el SMS del viajero y el aviso de la agencia) la consultan;
//   4. el código de verificación (OTP) no pasa por nada de esto;
//   5. nadie puede escribir suscripciones ni correr el reinicio desde un navegador;
//   6. el reinicio de preferencias respalda antes de apagar y respeta a los miembros Plus.
// Lee el SQL como texto (patrón del repo: los contratos de CI viven en scripts/test-*.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const RUTA = 'supabase/migrations/20261023003356_cobro_notificaciones_fase1_control_de_acceso.sql';
const sql = readFileSync(new URL('../' + RUTA, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

let casos = 0;
const prueba = (nombre, fn) => { fn(); casos++; };

/** El cuerpo de una función: desde su CREATE hasta el $function$; que la cierra. */
const cuerpoDe = (firma) => {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${firma}`);
  assert.ok(i > -1, `no está la función ${firma}`);
  const fin = sql.indexOf('$function$;', sql.indexOf('AS $function$', i) + 13);
  return sql.slice(i, fin);
};

prueba('el cobro arranca APAGADO y la gracia tiene tope', () => {
  assert.match(sql, /cobro_notificaciones_activo\s+boolean NOT NULL DEFAULT false/);
  assert.match(sql, /cobro_notificaciones_dias_gracia\s+integer NOT NULL DEFAULT 3/);
  assert.match(sql, /CHECK \(cobro_notificaciones_dias_gracia BETWEEN 0 AND 30\)/);
});

prueba('con el cobro apagado la cobertura devuelve «gratis» en su primera decisión, sin consultar nada más', () => {
  const f = cuerpoDe('messaging_private.cobertura_notificaciones');
  const gratis = f.indexOf("IF NOT v_vigente THEN RETURN 'gratis'; END IF;");
  assert.ok(gratis > -1, 'existe el atajo');
  // Nada que lea membresías o suscripciones puede ir ANTES del atajo (si no, apagado costaría consultas y podría fallar).
  for (const lectura of ['has_active_membership', 'suscripciones_notificaciones']) {
    assert.ok(f.indexOf(lectura) > gratis, `${lectura} se consulta después del atajo`);
  }
  // Lo único que se lee antes es la configuración, y «vigente» exige el interruptor encendido.
  assert.match(f, /v_vigente := s\.cobro_notificaciones_activo AND COALESCE\(s\.cobro_notificaciones_desde, now\(\)\) <= now\(\);/);
});

prueba('la decisión pura: gratis > plus > suscripción > gracia, y NULL si nada cubre', () => {
  const f = cuerpoDe('messaging_private.decidir_cobertura');
  const orden = ["'gratis'", "'plus'", "'suscripcion'", "'gracia'", 'ELSE NULL'].map((t) => f.indexOf(t));
  assert.ok(orden.every((n) => n > -1), 'están las cinco salidas');
  assert.deepEqual([...orden].sort((a, b) => a - b), orden, 'en ese orden de prioridad');
  assert.match(f, /WHEN NOT COALESCE\(p_vigente, false\) THEN 'gratis'/);
});

prueba('una agencia desconocida con el cobro vigente falla CERRADO; ToursRed Plus usa la regla que ya existe', () => {
  const f = cuerpoDe('messaging_private.cobertura_notificaciones');
  assert.match(f, /IF p_agency IS NULL THEN RETURN NULL; END IF;/);
  assert.match(f, /IF p_user IS NULL THEN RETURN NULL; END IF;/);
  assert.match(f, /v_plus := public\.has_active_membership\(p_user\);/, 'misma regla de Plus que la billetera de puntos');
  assert.match(f, /ELSE\s+RAISE EXCEPTION 'Tipo de cobertura invalido'/, 'un tipo raro no pasa en silencio');
});

prueba('los cuatro puntos de control consultan la cobertura', () => {
  // Viajero: se reescriben las funciones reales con un fragmento que se exige exactamente una vez.
  assert.match(sql, /cobertura_notificaciones\(''viajero'', u\.id, null\) is null then return null/, 'queue_booking_sms');
  assert.match(sql, /cobertura_notificaciones\(''viajero'', o\.user_id, null\) is null then return jsonb_build_object\(''allowed'',false\)/, 'prepare_sms_notification');
  assert.match(sql, /queue_booking_sms cambio: el fragmento aparece % veces, se esperaba 1/);
  assert.match(sql, /prepare_sms_notification cambio: el fragmento aparece % veces, se esperaba 1/);
  // Agencia: al encolar, y al despachar tanto el mensaje como la reserva/cancelación.
  assert.match(cuerpoDe('messaging_private.queue_agency_sms(p_user'), /cobertura_notificaciones\('agencia', u\.id, v_agency\) IS NULL THEN RETURN NULL/);
  const prepara = cuerpoDe('messaging_private.prepare_agency_sms');
  assert.equal((prepara.match(/cobertura_notificaciones\('agencia'/g) ?? []).length, 2, 'mensaje y reserva/cancelación');
  // Los disparadores pasan la agencia del evento.
  assert.match(sql, /queue_agency_sms\(r\.user_id, 'reserva', NEW\.id, NEW\.id, NEW\.agency_id\)/);
  assert.match(sql, /queue_agency_sms\(r\.user_id, 'cancelacion', NEW\.id, NEW\.id, NEW\.agency_id\)/);
  assert.match(sql, /queue_agency_sms\(r\.user_id, 'mensaje', NULL, NEW\.id, v_agency\)/);
  assert.match(sql, /DROP FUNCTION IF EXISTS messaging_private\.queue_agency_sms\(uuid, text, uuid, uuid\);/, 'sin una firma vieja ambigua');
});

prueba('el OTP NO pasa por nada de esto', () => {
  assert.ok(!/\botp\b/i.test(sinComentarios), 'la migración no menciona el OTP en código (solo en comentarios que lo declaran fuera)');
  assert.ok(!/begin_sms_attempt|finish_sms_attempt|record_sms_text|request-phone-otp|request-login-otp/.test(sinComentarios));
  assert.match(sql, /el codigo de verificacion \(OTP\) NO entra/i, 'queda dicho en el encabezado');
});

prueba('las suscripciones son de solo lectura para el usuario: nadie se da una suscripción a sí mismo', () => {
  assert.match(sql, /GRANT SELECT ON public\.suscripciones_notificaciones TO authenticated;/);
  assert.match(sql, /REVOKE ALL ON public\.suscripciones_notificaciones FROM PUBLIC, anon;/);
  assert.match(sql, /ALTER TABLE public\.suscripciones_notificaciones ENABLE ROW LEVEL SECURITY;/);
  const politicas = sql.match(/CREATE POLICY[^;]*;/g) ?? [];
  assert.equal(politicas.length, 3);
  for (const p of politicas) assert.match(p, /FOR SELECT TO authenticated/, 'solo políticas de lectura');
  assert.ok(!/FOR (INSERT|UPDATE|DELETE|ALL)/.test(politicas.join('\n')));
  assert.match(sql, /CHECK \(tipo IN \('viajero', 'agencia'\)\)/);
  assert.match(sql, /suscripciones_notificaciones_viva_unica[\s\S]{0,260}WHERE status IN \('incomplete', 'trialing', 'active', 'past_due'\)/, 'una viva por viajero o agencia');
});

prueba('el reinicio de preferencias: solo servicio y cron, respalda ANTES de apagar, respeta a Plus y no repite', () => {
  const grants = sql.match(/GRANT EXECUTE ON FUNCTION public\.aplicar_inicio_cobro_notificaciones\([^;]*;/g) ?? [];
  assert.deepEqual(grants, ['GRANT EXECUTE ON FUNCTION public.aplicar_inicio_cobro_notificaciones() TO service_role;']);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.aplicar_inicio_cobro_notificaciones\(\) FROM PUBLIC, anon, authenticated;/);
  // Sin comentarios: un INSERT dentro de un comentario no respalda nada.
  const f = cuerpoDe('public.aplicar_inicio_cobro_notificaciones').replace(/--.*$/gm, '');
  assert.ok(f.indexOf('INSERT INTO messaging_private.notification_preferences_respaldo') > -1, 'hay un INSERT real de respaldo');
  assert.ok(f.indexOf('INSERT INTO messaging_private.notification_preferences_respaldo') < f.indexOf('SET transactional_enabled'), 'respalda primero');
  assert.match(f, /cobertura_notificaciones\('viajero', r\.user_id, NULL\) IS NULL/, 'quien está cubierto (Plus) conserva su preferencia');
  assert.match(f, /IF NOT s\.cobro_notificaciones_activo THEN/, 'apagado: no toca preferencias');
  assert.match(f, /IF COALESCE\(s\.cobro_notificaciones_desde, now\(\)\) > now\(\) THEN RETURN 0; END IF;/, 'antes de la fecha: nada');
  assert.match(f, /IF s\.cobro_notificaciones_reseteado_en IS NOT NULL THEN RETURN 0; END IF;/, 'una sola vez');
  assert.match(f, /SET cobro_notificaciones_reseteado_en = now\(\)/);
  assert.match(sql, /cron\.schedule\('aplicar-cobro-notificaciones', '10 \* \* \* \*'/);
  assert.match(sql, /GRANT SELECT, INSERT ON messaging_private\.notification_preferences_respaldo TO service_role;/);
});

prueba('todas las funciones nuevas de SECURITY DEFINER fijan search_path y no se abren a navegadores', () => {
  const definer = sql.match(/CREATE OR REPLACE FUNCTION [^\n]+\n[\s\S]*?\$function\$;/g) ?? [];
  assert.ok(definer.length >= 9);
  for (const f of definer) {
    if (/SECURITY DEFINER/.test(f)) assert.match(f, /SET search_path TO ''/, f.split('\n')[0]);
  }
  for (const n of ['decidir_cobertura(boolean, boolean, boolean, boolean)', 'agencia_de_usuario(uuid)', 'cobertura_notificaciones(text, uuid, uuid)',
                   'queue_agency_sms(uuid, text, uuid, uuid, uuid)', 'prepare_agency_sms(messaging_private.notification_outbox)']) {
    assert.ok(sql.includes(`REVOKE ALL ON FUNCTION messaging_private.${n} FROM PUBLIC, anon, authenticated;`), n);
  }
});

console.log(`OK: ${casos} casos del control de acceso del cobro de notificaciones.`);
