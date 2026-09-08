-- ============================================================================
-- A-1 (auditoria edge functions 05-sep-2026): send-executive-notification exige
-- service role
--
-- POR QUE
--
-- send-executive-notification manda correo con el dominio y el SMTP de
-- ToursRed, y estaba en config.toml con verify_jwt = false y sin ningun control
-- dentro. Cualquiera en internet podia dispararla. El arreglo del lado de la
-- Edge Function es exigir el SERVICE_ROLE_KEY (requireServiceRole de
-- _shared/auth.ts).
--
-- Su unico llamador es esta funcion, que se dispara por trigger. Hoy manda la
-- PUBLISHABLE key en el header apikey (migracion 20260821212921), que es
-- publica por diseno y no autoriza nada. Con el guard nuevo esa llamada se
-- volveria un 401 y los avisos a los ejecutivos dejarian de salir.
--
-- QUE CAMBIA
--
-- Solo la credencial: la publishable key literal se sustituye por el
-- service_role_key del Vault, que es exactamente lo que ya hacen las otras dos
-- funciones que llaman Edge Functions por pg_net
-- (process_expired_slot_reschedules y process_membership_renewal_reminders,
-- ver 20260821212354).
--
-- La credencial va en LAS DOS cabeceras, `apikey` y `Authorization`, a
-- proposito. Comprobado en produccion el 08-sep-2026 antes de aplicar esto:
--
--   - vault.decrypted_secrets['service_role_key'] es hoy una llave del formato
--     NUEVO (sb_secret_..., 41 chars), no el JWT legacy.
--   - Los crons expire-supplement-approvals y
--     process-incremental-payment-deadlines mandan esa llave en
--     `Authorization: Bearer` y sus funciones YA tienen requireServiceRole
--     desplegado: 8 corridas cada uno, 19 respuestas 200 y ningun 401.
--
-- De ahi salen dos cosas. Primera: el valor del Vault coincide con lo que la
-- Edge Function lee en Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), asi que la
-- comparacion del guard da verdadero. Segunda: el comentario de la migracion
-- 20260821212354 —"el gateway rechaza el formato nuevo en Authorization:
-- Bearer"— hoy NO se cumple; Authorization funciona.
--
-- Lo unico que sigue sin comprobarse es si el gateway REENVIA el header
-- `apikey` hasta la funcion, y no se puede comprobar hasta desplegar el guard.
-- Mandando las dos, esa duda deja de importar: si `apikey` no llega,
-- Authorization cubre; si llega, tambien. _shared/auth.ts mira los dos sitios.
--
-- Todo lo demas se conserva: misma firma, mismo SECURITY DEFINER, mismo
-- search_path, mismo timeout, mismo EXCEPTION WHEN OTHERS.
--
-- ORDEN DE DESPLIEGUE
--
-- Esta migracion va ANTES de desplegar send-executive-notification. Al reves,
-- hay una ventana en la que el trigger llama con una credencial que la funcion
-- ya rechaza.
--
-- COMO COMPROBARLO
--
--   select length(decrypted_secret) from vault.decrypted_secrets
--    where name = 'service_role_key';
--
-- y despues reproducir la llamada con net.http_post leyendo el status_code en
-- net._http_response, en vez de esperar a que la descubra un ejecutivo que no
-- recibio su aviso.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_executive_by_email(p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- La URL es publica; la credencial ya NO: send-executive-notification exige
  -- service role desde A-1.
  v_supabase_url TEXT := 'https://huzsedewwzjywcpbkjkm.supabase.co';
  v_service_key  TEXT := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key');
BEGIN
  PERFORM net.http_post(
    url     := v_supabase_url || '/functions/v1/send-executive-notification',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        v_service_key,
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := p_payload,
    timeout_milliseconds := 10000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_executive_by_email error: %', SQLERRM;
END;
$function$;
