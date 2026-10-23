-- Cobro de las notificaciones por suscripcion: FASE 2, Stripe. SIGUE APAGADO POR DEFECTO.
--
-- Lo de esta migracion es la parte de base de datos de la suscripcion:
--   1. DOS Price IDs de Stripe (viajero y agencia) en la configuracion. Se captura el Price (price_...), NO el Product (prod_...):
--      Checkout de suscripciones pide el Price. Un CHECK rechaza pegar un producto por error.
--   2. mi_cobertura_notificaciones(): lo que necesitan las pantallas del perfil para decir "incluido con Plus", "activa hasta..."
--      o "activala por $X", sin leer la configuracion ni las tablas internas.
--   3. Un margen de UN DIA en la cobertura por suscripcion. Al renovar, Stripe cobra una hora despues de current_period_end y el
--      webhook llega despues: sin margen, una suscripcion al corriente quedaria descubierta unas horas cada mes.
--
-- El resto (crear el cobro, administrarlo y recibir los eventos de Stripe) vive en Edge Functions. El cobro sigue gobernado por
-- platform_settings.cobro_notificaciones_activo, que sigue en false: esta migracion no cambia lo que hoy sale ni lo que no.

-- 1. Price IDs --------------------------------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS stripe_price_notificaciones_viajero text,
  ADD COLUMN IF NOT EXISTS stripe_price_notificaciones_agencia text;

ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_price_notif_viajero_check
    CHECK (stripe_price_notificaciones_viajero IS NULL OR stripe_price_notificaciones_viajero ~ '^price_[A-Za-z0-9]+$'),
  ADD CONSTRAINT platform_settings_price_notif_agencia_check
    CHECK (stripe_price_notificaciones_agencia IS NULL OR stripe_price_notificaciones_agencia ~ '^price_[A-Za-z0-9]+$');

COMMENT ON COLUMN public.platform_settings.stripe_price_notificaciones_viajero IS
  'Price ID (price_...) de Stripe de la suscripcion mensual de notificaciones del viajero. No es el Product ID. Debe existir en la cuenta de Stripe que usan las llaves de las Edge Functions.';
COMMENT ON COLUMN public.platform_settings.stripe_price_notificaciones_agencia IS
  'Price ID (price_...) de Stripe de la suscripcion mensual de notificaciones de la agencia (una por agencia: cubre al dueno y a su personal).';

-- 2. Margen de un dia en la cobertura por suscripcion -------------------------------------------------------------
-- Solo cuenta si Stripe todavia dice active/trialing: una suscripcion cancelada o vencida cambia de estado por el webhook
-- y deja de contar al instante, asi que el margen no alarga nada que ya se haya dado de baja.
DO $$
DECLARE
  d text;
  veces integer;
  viejo text := 'x.current_period_end > now()';
  nuevo text := 'x.current_period_end + interval ''1 day'' > now()';
BEGIN
  SELECT pg_get_functiondef('messaging_private.cobertura_notificaciones(text,uuid,uuid)'::regprocedure) INTO d;
  veces := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
  IF veces <> 2 THEN
    RAISE EXCEPTION 'cobertura_notificaciones cambio: el fragmento aparece % veces, se esperaba 2 (viajero y agencia)', veces;
  END IF;
  EXECUTE replace(d, viejo, nuevo);
END $$;

-- 3. Lo que ve la pantalla -----------------------------------------------------------------------------------------
-- p_agency NULL = el viajero mismo; con una agencia, quien llama debe ser su dueno o su personal activo. Solo el dueno puede
-- contratar o administrar (es_dueno); el personal ve que esta cubierto, no el cobro.
CREATE OR REPLACE FUNCTION public.mi_cobertura_notificaciones(p_agency uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  s public.platform_settings;
  v_vigente boolean;
  v_es_dueno boolean := false;
  v_cobertura text;
  v_plus boolean := false;
  v_precio_listo boolean;
  v_sub public.suscripciones_notificaciones;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT * INTO STRICT s FROM public.platform_settings;
  v_vigente := s.cobro_notificaciones_activo AND COALESCE(s.cobro_notificaciones_desde, now()) <= now();

  IF p_agency IS NULL THEN
    v_es_dueno := true;
    v_plus := public.has_active_membership(v_uid);
    v_cobertura := messaging_private.cobertura_notificaciones('viajero', v_uid, NULL);
    v_precio_listo := s.stripe_price_notificaciones_viajero IS NOT NULL;
    SELECT * INTO v_sub FROM public.suscripciones_notificaciones x
     WHERE x.tipo = 'viajero' AND x.user_id = v_uid
     ORDER BY (x.status IN ('incomplete', 'trialing', 'active', 'past_due')) DESC, x.created_at DESC LIMIT 1;
  ELSE
    v_es_dueno := EXISTS (SELECT 1 FROM public.agencies a WHERE a.id = p_agency AND a.user_id = v_uid);
    IF NOT v_es_dueno AND NOT EXISTS (
      SELECT 1 FROM public.agency_staff st WHERE st.agency_id = p_agency AND st.user_id = v_uid AND st.is_active) THEN
      RAISE EXCEPTION 'Sin acceso a la agencia';
    END IF;
    v_cobertura := messaging_private.cobertura_notificaciones('agencia', NULL, p_agency);
    v_precio_listo := s.stripe_price_notificaciones_agencia IS NOT NULL;
    SELECT * INTO v_sub FROM public.suscripciones_notificaciones x
     WHERE x.tipo = 'agencia' AND x.agency_id = p_agency
     ORDER BY (x.status IN ('incomplete', 'trialing', 'active', 'past_due')) DESC, x.created_at DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'vigente', v_vigente,
    'activo', s.cobro_notificaciones_activo,
    'desde', s.cobro_notificaciones_desde,
    'cobertura', v_cobertura,
    'tiene_plus', v_plus,
    'es_dueno', v_es_dueno,
    'precio_listo', v_precio_listo,
    'suscripcion', CASE WHEN v_sub.id IS NULL THEN NULL ELSE jsonb_build_object(
      'status', v_sub.status,
      'current_period_end', v_sub.current_period_end,
      'cancel_at_period_end', v_sub.cancel_at_period_end,
      'en_gracia_hasta', v_sub.en_gracia_hasta,
      'price_paid', v_sub.price_paid) END
  );
END
$function$;

REVOKE ALL ON FUNCTION public.mi_cobertura_notificaciones(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mi_cobertura_notificaciones(uuid) TO authenticated, service_role;
