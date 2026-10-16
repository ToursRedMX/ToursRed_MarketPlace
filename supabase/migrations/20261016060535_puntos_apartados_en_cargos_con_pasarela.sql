-- Puntos + pasarela en suplementos, extras y mensualidades: apartar los puntos
-- al crear el cobro, consumirlos al confirmar y liberarlos si nunca se pago.
--
-- ============================================================================
-- CONTEXTO
-- ============================================================================
--
-- Regla de Axel (16-oct-2026): los puntos cubren hasta el 50% de cualquier
-- pago y se combinan con cualquier metodo. 20261016042518 los permitio con
-- ToursRed Cash (todo interno, en una transaccion). Con pasarela el cobro es en
-- dos tiempos -se crea, y despues el procesador confirma-, asi que se usa el
-- mismo patron que las reservas (20261016054040): apartar al crear, para que
-- nadie confirme un descuento que no se pago.
--
-- A diferencia de la reserva, estos cargos no tienen una fila propia donde
-- guardar lo apartado antes de pagarse (el seguro no tiene fila; el abono la
-- crea al confirmar). Por eso una tabla de apartados, una fila por intento,
-- con su propia referencia en el movimiento de puntos: deduct_points no repite
-- un canje con la misma referencia, y un segundo intento del mismo cargo debe
-- descontar.
--
-- Este PR cubre Stripe en los tres cargos. MercadoPago, PayPal, Conekta y
-- OpenPay usan la misma base en el siguiente; mientras, las Edge Functions
-- siguen rechazando puntos con esos metodos.
--
-- ============================================================================
-- CICLO DE VIDA
-- ============================================================================
--
--   apartar   al crear el cobro: descuenta los puntos (redeemed, referencia =
--             el apartado). Un reintento con los mismos puntos reusa el apartado;
--             con otros, libera el anterior.
--   consumir  al confirmar el pago (webhook): marca consumido y escribe
--             points_used en el cargo (booking_supplements,
--             booking_optional_services, o travel_insurance_points_used de la
--             reserva). El abono no tiene fila hasta ese momento: el webhook
--             recibe los puntos y los guarda al insertar la transaccion.
--             Idempotente: un webhook repetido recibe lo ya consumido.
--   liberar   si vence sin pagarse: devuelve los puntos. El cobro se crea con
--             expiracion (Stripe: 2 h) y el apartado vence despues (3 h), asi que
--             un pago ya no puede llegar cuando se liberan. Un cron cada hora.

-- ============================================================================
-- 1. TABLA
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.puntos_apartados_cargos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  contexto     text NOT NULL CHECK (contexto IN ('supplement', 'optional_service', 'insurance', 'payment_plan_installment')),
  referencia   uuid NOT NULL,
  puntos       integer NOT NULL CHECK (puntos > 0),
  estado       text NOT NULL DEFAULT 'apartado' CHECK (estado IN ('apartado', 'consumido', 'liberado')),
  creado_en    timestamptz NOT NULL DEFAULT now(),
  vence_en     timestamptz NOT NULL,
  consumido_en timestamptz,
  liberado_en  timestamptz
);

COMMENT ON TABLE public.puntos_apartados_cargos IS
  'Puntos apartados al crear el cobro con pasarela de un suplemento, extra o abono. Ver 20261016060535.';

-- A lo mas un apartado vivo por cargo.
CREATE UNIQUE INDEX IF NOT EXISTS puntos_apartados_cargos_uno_vivo
  ON public.puntos_apartados_cargos (contexto, referencia) WHERE estado = 'apartado';
CREATE INDEX IF NOT EXISTS puntos_apartados_cargos_vencidos
  ON public.puntos_apartados_cargos (vence_en) WHERE estado = 'apartado';

-- Solo el servidor: sin politicas, RLS niega todo a anon y authenticated.
ALTER TABLE public.puntos_apartados_cargos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.puntos_apartados_cargos FROM anon, authenticated;

-- reference_type del movimiento de puntos, por contexto (valores ya permitidos
-- por el CHECK de toursred_points_transactions).
CREATE OR REPLACE FUNCTION public.tipo_referencia_de_cargo(p_contexto text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE p_contexto
    WHEN 'supplement' THEN 'supplement_payment'
    WHEN 'optional_service' THEN 'optional_service_payment'
    WHEN 'insurance' THEN 'insurance_payment'
    WHEN 'payment_plan_installment' THEN 'payment_plan'
  END
$function$;

-- ============================================================================
-- 2. LIBERAR
-- ============================================================================

CREATE OR REPLACE FUNCTION public.liberar_puntos_de_cargo(p_apartado_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_a record;
BEGIN
  SELECT * INTO v_a FROM puntos_apartados_cargos WHERE id = p_apartado_id FOR UPDATE;
  IF NOT FOUND OR v_a.estado <> 'apartado' THEN
    RETURN 0;
  END IF;

  PERFORM public.reembolsar_saldo_y_puntos(
    v_a.user_id, 0, v_a.puntos, 0, v_a.id,
    public.tipo_referencia_de_cargo(v_a.contexto), NULL,
    'Pago no completado: se devuelven los puntos apartados', NULL
  );

  UPDATE puntos_apartados_cargos SET estado = 'liberado', liberado_en = now() WHERE id = v_a.id;
  RETURN v_a.puntos;
END;
$function$;

-- ============================================================================
-- 3. APARTAR
-- ============================================================================

CREATE OR REPLACE FUNCTION public.apartar_puntos_de_cargo(
  p_user_id uuid,
  p_contexto text,
  p_referencia uuid,
  p_puntos integer,
  p_vence_en timestamptz
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vivo record;
  v_id   uuid;
BEGIN
  IF coalesce(p_puntos, 0) <= 0 THEN
    RAISE EXCEPTION 'Nada que apartar';
  END IF;
  IF p_vence_en IS NULL OR p_vence_en <= now() THEN
    RAISE EXCEPTION 'El apartado necesita un vencimiento futuro';
  END IF;

  SELECT * INTO v_vivo FROM puntos_apartados_cargos
   WHERE contexto = p_contexto AND referencia = p_referencia AND estado = 'apartado'
   FOR UPDATE;
  IF FOUND THEN
    IF v_vivo.user_id = p_user_id AND v_vivo.puntos = p_puntos THEN
      -- Reintento del mismo cobro: se reusa, con el vencimiento del cobro nuevo.
      UPDATE puntos_apartados_cargos SET vence_en = greatest(vence_en, p_vence_en) WHERE id = v_vivo.id;
      RETURN v_vivo.id;
    END IF;
    PERFORM public.liberar_puntos_de_cargo(v_vivo.id);
  END IF;

  INSERT INTO puntos_apartados_cargos (user_id, contexto, referencia, puntos, vence_en)
  VALUES (p_user_id, p_contexto, p_referencia, p_puntos, p_vence_en)
  RETURNING id INTO v_id;

  -- Referencia = el apartado: cada intento descuenta (deduct_points no repite
  -- un canje con la misma referencia). Si no alcanza, lanza y no queda fila.
  PERFORM public.deduct_points(
    p_user_id, p_puntos, 'Puntos apartados para el pago', v_id,
    public.tipo_referencia_de_cargo(p_contexto)
  );
  RETURN v_id;
END;
$function$;

-- ============================================================================
-- 4. CONSUMIR
-- ============================================================================

CREATE OR REPLACE FUNCTION public.consumir_puntos_de_cargo(p_contexto text, p_referencia uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_a record;
BEGIN
  SELECT * INTO v_a FROM puntos_apartados_cargos
   WHERE contexto = p_contexto AND referencia = p_referencia AND estado = 'apartado'
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Webhook repetido: lo que ya se consumio para este cargo.
    SELECT * INTO v_a FROM puntos_apartados_cargos
     WHERE contexto = p_contexto AND referencia = p_referencia AND estado = 'consumido'
     ORDER BY consumido_en DESC LIMIT 1;
    IF FOUND THEN
      RETURN v_a.puntos;
    END IF;

    -- El pago llego DESPUES de liberar (no deberia: el cobro expira antes del
    -- apartado). El descuento ya se cobro en la pasarela, asi que se intenta
    -- descontar otra vez en vez de regalarlo. Si ya no alcanzan, queda el aviso.
    SELECT * INTO v_a FROM puntos_apartados_cargos
     WHERE contexto = p_contexto AND referencia = p_referencia AND estado = 'liberado'
     ORDER BY liberado_en DESC LIMIT 1;
    IF NOT FOUND THEN
      RETURN 0;
    END IF;
    BEGIN
      v_a.id := public.apartar_puntos_de_cargo(v_a.user_id, p_contexto, p_referencia, v_a.puntos, now() + interval '1 hour');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'consumir_puntos_de_cargo: el pago de % % llego despues de liberar % puntos y ya no se pudieron descontar: %',
        p_contexto, p_referencia, v_a.puntos, SQLERRM;
      RETURN 0;
    END;
  END IF;

  UPDATE puntos_apartados_cargos SET estado = 'consumido', consumido_en = now() WHERE id = v_a.id;

  IF p_contexto = 'supplement' THEN
    UPDATE booking_supplements SET points_used = v_a.puntos WHERE id = p_referencia;
  ELSIF p_contexto = 'optional_service' THEN
    UPDATE booking_optional_services SET points_used = v_a.puntos WHERE id = p_referencia;
  ELSIF p_contexto = 'insurance' THEN
    UPDATE bookings SET travel_insurance_points_used = v_a.puntos WHERE id = p_referencia;
  END IF;
  -- payment_plan_installment: el abono no tiene fila todavia; quien llama
  -- guarda los puntos al insertar la transaccion.

  RETURN v_a.puntos;
END;
$function$;

-- ============================================================================
-- 5. LIBERAR LOS VENCIDOS (cron)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.liberar_puntos_apartados_vencidos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_n  integer := 0;
BEGIN
  FOR v_id IN
    SELECT id FROM puntos_apartados_cargos
     WHERE estado = 'apartado' AND vence_en < now()
     ORDER BY vence_en
     LIMIT 500
  LOOP
    PERFORM public.liberar_puntos_de_cargo(v_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.tipo_referencia_de_cargo(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.liberar_puntos_de_cargo(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apartar_puntos_de_cargo(uuid, text, uuid, integer, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consumir_puntos_de_cargo(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.liberar_puntos_apartados_vencidos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tipo_referencia_de_cargo(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.liberar_puntos_de_cargo(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apartar_puntos_de_cargo(uuid, text, uuid, integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.consumir_puntos_de_cargo(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.liberar_puntos_apartados_vencidos() TO service_role;

-- Cada hora. Solo donde existe pg_cron (no en la base de pruebas de CI).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'liberar-puntos-apartados-vencidos') THEN
      PERFORM cron.unschedule('liberar-puntos-apartados-vencidos');
    END IF;
    PERFORM cron.schedule(
      'liberar-puntos-apartados-vencidos',
      '20 * * * *',
      $job$SELECT public.liberar_puntos_apartados_vencidos();$job$
    );
  END IF;
END $$;
