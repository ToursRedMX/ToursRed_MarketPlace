-- ============================================================================
-- A-1 (auditoria edge functions 05-sep-2026): los 2 crons que solo mandaban
-- `apikey` ahora mandan tambien `Authorization`
--
-- POR QUE
--
-- Estas dos funciones llaman Edge Functions por pg_net y mandan el
-- service_role_key SOLO en el header `apikey`:
--
--   process_membership_renewal_reminders -> send-membership-renewal-reminder
--   process_expired_slot_reschedules     -> send-slot-reschedule-auto-cancelled-traveler
--                                        -> send-slot-reschedule-auto-cancelled-agency
--
-- Esas 3 Edge Functions pasan a exigir service role (requireServiceRole de
-- _shared/auth.ts). El guard mira las dos cabeceras, pero queda una suposicion
-- sin comprobar: que el gateway de Supabase REENVIE `apikey` hasta la funcion.
-- No se puede comprobar hasta desplegar el guard, y si resultara que no lo
-- reenvia, estos dos crons se caerian EN SILENCIO —son fire-and-forget, el
-- cron seguiria marcandose "succeeded"— y nos quedariamos sin recordatorios de
-- renovacion de membresia y sin los correos de cancelacion por reagenda.
--
-- Mandando las dos cabeceras la suposicion deja de importar.
--
-- POR QUE `Authorization` SI FUNCIONA (comprobado, no supuesto)
--
-- El comentario de la migracion 20260821212354 decia que el gateway rechaza el
-- formato nuevo de llaves (sb_secret_/sb_publishable_) en Authorization: Bearer.
-- Hoy 08-sep-2026 eso NO se cumple. Evidencia en produccion:
--
--   - vault.decrypted_secrets['service_role_key'] es una llave del formato
--     NUEVO (sb_secret_..., 41 chars).
--   - Los crons expire-supplement-approvals y
--     process-incremental-payment-deadlines mandan esa misma llave en
--     `Authorization: Bearer` y sus Edge Functions YA tienen requireServiceRole
--     desplegado: 8 corridas cada uno, 19 respuestas 200 en net._http_response
--     y ningun 401.
--
-- De paso eso confirma que el valor del Vault coincide con lo que la Edge
-- Function lee en Deno.env.get('SUPABASE_SERVICE_ROLE_KEY').
--
-- COMO ESTA ESCRITA ESTA MIGRACION, Y POR QUE
--
-- No reescribe las funciones: lee su definicion viva con pg_get_functiondef,
-- le inserta la cabecera con regexp_replace y la reejecuta. Es a proposito.
-- process_expired_slot_reschedules tiene 7,581 caracteres y logica de
-- reembolsos; copiarla a mano para cambiar dos lineas es justo como se
-- introducen errores que nadie nota hasta que un viajero no recibe su
-- reembolso. Asi lo unico que cambia es lo que dice el regex.
--
-- Es reproducible: cuando esta migracion corre, las funciones ya existen con
-- su cuerpo anterior (migraciones 20260821212354 y posteriores). Si el patron
-- no aparece, la migracion FALLA en vez de dejar el cambio a medias.
-- Si ya trae Authorization, no hace nada (idempotente).
--
-- COMO COMPROBARLO DESPUES
--
--   select p.proname,
--          (select count(*) from regexp_matches(pg_get_functiondef(p.oid), 'Authorization', 'g'))
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('process_membership_renewal_reminders',
--                        'process_expired_slot_reschedules');
--
-- Esperado: 1 y 2 respectivamente (una por cada llamada net.http_post).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. process_membership_renewal_reminders  (variable: service_key, 1 llamada)
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_def   text;
  v_nuevo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'process_membership_renewal_reminders';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'process_membership_renewal_reminders no existe';
  END IF;

  IF position('Authorization' in v_def) > 0 THEN
    RAISE NOTICE 'process_membership_renewal_reminders ya manda Authorization; sin cambios';
    RETURN;
  END IF;

  v_nuevo := regexp_replace(
    v_def,
    '(''apikey'',\s*service_key)',
    '\1,' || chr(10) || '''Authorization'', ''Bearer '' || service_key',
    'g'
  );

  IF v_nuevo = v_def THEN
    RAISE EXCEPTION
      'No se encontro la cabecera apikey en process_membership_renewal_reminders; no se toca nada';
  END IF;

  EXECUTE v_nuevo;
  RAISE NOTICE 'process_membership_renewal_reminders actualizada';
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2. process_expired_slot_reschedules  (variable: v_service_key, 2 llamadas)
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_def   text;
  v_nuevo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'process_expired_slot_reschedules';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'process_expired_slot_reschedules no existe';
  END IF;

  IF position('Authorization' in v_def) > 0 THEN
    RAISE NOTICE 'process_expired_slot_reschedules ya manda Authorization; sin cambios';
    RETURN;
  END IF;

  v_nuevo := regexp_replace(
    v_def,
    '(''apikey'',\s*v_service_key)',
    '\1,' || chr(10) || '''Authorization'', ''Bearer '' || v_service_key',
    'g'
  );

  IF v_nuevo = v_def THEN
    RAISE EXCEPTION
      'No se encontro la cabecera apikey en process_expired_slot_reschedules; no se toca nada';
  END IF;

  EXECUTE v_nuevo;
  RAISE NOTICE 'process_expired_slot_reschedules actualizada';
END
$mig$;
