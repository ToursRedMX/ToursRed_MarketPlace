-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827070233
--   name:    20260827130000_routesred_platform_rpc_hardening.sql
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

/*
 * # RoutesRed Platform RPC Hardening
 *
 * ## Overview
 * Corrige migration drift: las funciones routesred.register_platform_access,
 * complete_onboarding y touch_platform_access fueron modificadas en Git
 * pero los cambios nunca se aplicaron como nueva migración.
 *
 * ## Strategy: Backward-compatible
 * 1. Crea nuevas funciones canónicas SIN parámetros
 * 2. Mantiene las firmas legacy como wrappers de compatibilidad que:
 *    - Requieren autenticación (auth.uid())
 *    - Rechazan cualquier p_platform <> 'routesred'
 *    - Exigen p_source = 'routesred'
 *    - Delegan a las nuevas funciones sin parámetros
 * 3. Endurece permisos: REVOKE FROM PUBLIC, anon
;

GRANT TO authenticated
 *
 * ## No data loss
 * - No se eliminan tablas ni columnas
 * - No se modifica public.user_platforms
 * - No se modifican funciones de ToursRed
 *
 * 1. New/Modified Functions
 * - routesred.register_platform_access() — canónica sin parámetros
 * - routesred.complete_onboarding() — canónica sin parámetros
 * - routesred.touch_platform_access() — canónica sin parámetros
 * - routesred.register_platform_access(text, text) — wrapper legacy
 * - routesred.complete_onboarding(text) — wrapper legacy
 * - routesred.touch_platform_access(text) — wrapper legacy
 *
 * 2. Security
 * - SECURITY DEFINER en todas las funciones
 * - search_path fijo: 'public', 'routesred'
 * - REVOKE EXECUTE FROM PUBLIC, anon
 * - GRANT EXECUTE TO authenticated
 * - Usa auth.uid() para identificación
 */

-- ============================================================
-- 1. Canonical functions (no parameters)
-- ============================================================

-- 1a. register_platform_access()
CREATE OR REPLACE FUNCTION routesred.register_platform_access()
RETURNS public.user_platforms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'routesred'
AS $function$
DECLARE
  v_uid uuid := auth.uid()
;


  v_row public.user_platforms
;


BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
;


  END IF
;



  SELECT * INTO v_row
  FROM public.user_platforms
  WHERE user_id = v_uid AND platform = 'routesred'
;



  IF v_row IS NULL THEN
    INSERT INTO public.user_platforms
      (user_id, platform, status, registration_source, registered_at, last_access_at, onboarding_completed)
    VALUES
      (v_uid, 'routesred', 'active', 'routesred', now(), now(), false)
    RETURNING * INTO v_row
;


  ELSE
    UPDATE public.user_platforms
    SET last_access_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row
;


  END IF
;



  RETURN v_row
;


END
;


$function$
;



-- 1b. complete_onboarding()
CREATE OR REPLACE FUNCTION routesred.complete_onboarding()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'routesred'
AS $function$
DECLARE
  v_uid uuid := auth.uid()
;


BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
;


  END IF
;



  UPDATE public.user_platforms
  SET onboarding_completed = true
  WHERE user_id = v_uid AND platform = 'routesred'
;



  RETURN FOUND
;


END
;


$function$
;



-- 1c. touch_platform_access()
CREATE OR REPLACE FUNCTION routesred.touch_platform_access()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'routesred'
AS $function$
DECLARE
  v_uid uuid := auth.uid()
;


BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
;


  END IF
;



  UPDATE public.user_platforms
  SET last_access_at = now()
  WHERE user_id = v_uid AND platform = 'routesred'
;


END
;


$function$
;



-- ============================================================
-- 2. Legacy wrappers (backward compatibility)
--    Rechazan cualquier p_platform <> 'routesred' y p_source <> 'routesred'
--    Delegan a las funciones canónicas sin parámetros
-- ============================================================

-- 2a. register_platform_access(p_platform, p_source) — wrapper
CREATE OR REPLACE FUNCTION routesred.register_platform_access(p_platform text, p_source text DEFAULT 'routesred')
RETURNS public.user_platforms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'routesred'
AS $function$
DECLARE
  v_uid uuid := auth.uid()
;


BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
;


  END IF
;



  IF p_platform IS NULL OR p_platform <> 'routesred' THEN
    RAISE EXCEPTION 'Invalid platform: %. Only routesred is allowed.', p_platform
;


  END IF
;



  IF p_source IS NULL OR p_source <> 'routesred' THEN
    RAISE EXCEPTION 'Invalid source: %. Only routesred is allowed.', p_source
;


  END IF
;



  -- Delegate to canonical function
  RETURN routesred.register_platform_access()
;


END
;


$function$
;



-- 2b. complete_onboarding(p_platform) — wrapper
CREATE OR REPLACE FUNCTION routesred.complete_onboarding(p_platform text DEFAULT 'routesred')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'routesred'
AS $function$
DECLARE
  v_uid uuid := auth.uid()
;


BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
;


  END IF
;



  IF p_platform IS NULL OR p_platform <> 'routesred' THEN
    RAISE EXCEPTION 'Invalid platform: %. Only routesred is allowed.', p_platform
;


  END IF
;



  -- Delegate to canonical function
  RETURN routesred.complete_onboarding()
;


END
;


$function$
;



-- 2c. touch_platform_access(p_platform) — wrapper
CREATE OR REPLACE FUNCTION routesred.touch_platform_access(p_platform text DEFAULT 'routesred')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'routesred'
AS $function$
DECLARE
  v_uid uuid := auth.uid()
;


BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
;


  END IF
;



  IF p_platform IS NULL OR p_platform <> 'routesred' THEN
    RAISE EXCEPTION 'Invalid platform: %. Only routesred is allowed.', p_platform
;


  END IF
;



  -- Delegate to canonical function
  PERFORM routesred.touch_platform_access()
;


END
;


$function$
;



-- ============================================================
-- 3. Harden permissions on all six functions
-- ============================================================
REVOKE EXECUTE ON FUNCTION routesred.register_platform_access() FROM PUBLIC, anon
;


REVOKE EXECUTE ON FUNCTION routesred.complete_onboarding() FROM PUBLIC, anon
;


REVOKE EXECUTE ON FUNCTION routesred.touch_platform_access() FROM PUBLIC, anon
;


REVOKE EXECUTE ON FUNCTION routesred.register_platform_access(text, text) FROM PUBLIC, anon
;


REVOKE EXECUTE ON FUNCTION routesred.complete_onboarding(text) FROM PUBLIC, anon
;


REVOKE EXECUTE ON FUNCTION routesred.touch_platform_access(text) FROM PUBLIC, anon
;



GRANT EXECUTE ON FUNCTION routesred.register_platform_access() TO authenticated
;


GRANT EXECUTE ON FUNCTION routesred.complete_onboarding() TO authenticated
;


GRANT EXECUTE ON FUNCTION routesred.touch_platform_access() TO authenticated
;


GRANT EXECUTE ON FUNCTION routesred.register_platform_access(text, text) TO authenticated
;


GRANT EXECUTE ON FUNCTION routesred.complete_onboarding(text) TO authenticated
;


GRANT EXECUTE ON FUNCTION routesred.touch_platform_access(text) TO authenticated
;
