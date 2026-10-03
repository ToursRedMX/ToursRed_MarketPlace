-- ============================================================================
-- BOOKING_CONFIRMED se escribia dos veces por reserva pagada con Stripe.
--
-- audit_bookings_change() (trigger generico AFTER UPDATE en bookings, entrada
-- tecnica de la migracion 20260715184423) ya inserta un BOOKING_CONFIRMED
-- CADA VEZ que `status` pasa a 'confirmed', para CUALQUIER camino que
-- actualice la fila -- los cinco procesadores, el admin, lo que sea. Corre
-- con la llave de servicio (sin sesion), asi que `auth.uid()` es NULL y queda
-- `actor_role = 'system'`, `actor_id = NULL`.
--
-- `stripe-webhook` (y SOLO stripe-webhook: medido con
-- `grep -rl BOOKING_CONFIRMED supabase/functions`) ademas llamaba
-- `insert_audit_log` EXPLICITO justo despues del mismo UPDATE, con
-- `actor_id = booking.user_id`, `actor_role = 'stripe_webhook'` y el
-- `payment_method`/`payment_intent_id` en los metadatos. Dos filas por
-- reserva, a milisegundos de distancia -- medido en produccion el 03-oct-2026
-- (pendiente 4 de la entrada 33): 67 filas BOOKING_CONFIRMED, 56 reservas
-- distintas, 10 de ellas con una fila 'stripe_webhook' de mas. (Una, adicion
-- aparte sin tocar aqui: `ab70a20b...` tiene DOS filas 'stripe_webhook' a 40
-- segundos — el webhook se re-entrego y confirmo dos veces; es un problema de
-- idempotencia del webhook, no de este duplicado, y no se investiga en esta
-- entrada.)
--
-- EL ARREGLO NO ES BORRAR LA LLAMADA EXPLICITA SIN MAS: esa llamada es la
-- UNICA fuente del `payment_method`/`payment_intent_id` en la bitacora, y
-- las otras cuatro procesadoras (PayPal, OpenPay, Conekta, MercadoPago) NUNCA
-- tuvieron ese detalle -- confirmar con ellas deja la fila de
-- `audit_bookings_change()` sola, sin metadatos de pago. Borrar sin más la
-- llamada de Stripe le bajaria la calidad a su auditoria para igualarla a la
-- de los demas, en vez de subir la de los demas.
--
-- Asi que el metadata se mueve a donde ya corre para los cinco: dentro de
-- audit_bookings_change(), que en el momento del trigger YA tiene
-- `NEW.payment_method` y `NEW.payment_intent_id` porque son parte del mismo
-- UPDATE que dispara el trigger. Con eso la llamada explicita de
-- stripe-webhook queda enteramente redundante y se borra ahi (ver el diff de
-- supabase/functions/stripe-webhook/index.ts en el mismo commit).
--
-- Prueba: scripts/test-audit-bookings-sin-duplicar.sql (corre en CI contra
-- Postgres real).
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_bookings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action       text;
  v_severity     text := 'info';
  v_sqlerrm      text;
  v_sqlstate     text;
  v_actor_id     uuid;
  v_actor_email  text;
  v_actor_role   text;
BEGIN
  -- Resolve actor
  v_actor_id := auth.uid();
  IF v_actor_id IS NOT NULL THEN
    SELECT email, role INTO v_actor_email, v_actor_role
    FROM public.users WHERE id = v_actor_id;
  ELSE
    v_actor_role := 'system';
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
      p_target_id    => OLD.id::text,
      p_target_table => 'bookings',
      p_action       => 'DELETE',
      p_severity     => 'critical',
      p_old_values   => to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
      p_target_id    => NEW.id::text,
      p_target_table => 'bookings',
      p_action       => 'BOOKING_CREATED',
      p_severity     => 'info',
      p_new_values   => to_jsonb(NEW)
    );
    RETURN NEW;
  END IF;

  -- UPDATE — detect status transitions
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    CASE NEW.status
      WHEN 'confirmed' THEN
        v_action   := 'BOOKING_CONFIRMED';
        v_severity := 'info';
      WHEN 'cancelled' THEN
        v_action   := 'BOOKING_CANCELLED';
        v_severity := 'warning';
      WHEN 'completed' THEN
        v_action   := 'BOOKING_COMPLETED';
        v_severity := 'info';
      ELSE
        v_action   := 'BOOKING_STATUS_CHANGED';
        v_severity := 'info';
    END CASE;

    PERFORM insert_audit_log(
      p_tenant_type  => 'system',
      p_actor_id     => v_actor_id,
      p_actor_email  => v_actor_email,
      p_actor_role   => v_actor_role,
      p_target_id    => NEW.id::text,
      p_target_table => 'bookings',
      p_action       => v_action,
      p_severity     => v_severity,
      p_old_values   => jsonb_build_object('status', OLD.status),
      -- payment_method y payment_intent_id salian SOLO de la llamada
      -- explicita que hacia stripe-webhook (y que esta migracion retira):
      -- se mueven aqui para que los cinco procesadores los dejen por igual,
      -- no solo Stripe.
      p_new_values   => jsonb_build_object(
        'status', NEW.status,
        'payment_method', NEW.payment_method,
        'payment_intent_id', NEW.payment_intent_id
      )
    );
    RETURN NEW;
  END IF;

  -- Generic UPDATE fallback
  PERFORM insert_audit_log(
    p_tenant_type  => 'system',
    p_actor_id     => v_actor_id,
    p_actor_email  => v_actor_email,
    p_actor_role   => v_actor_role,
    p_target_id    => NEW.id::text,
    p_target_table => 'bookings',
    p_action       => 'UPDATE',
    p_severity     => 'info',
    p_old_values   => to_jsonb(OLD),
    p_new_values   => to_jsonb(NEW)
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;
  RAISE WARNING 'audit_bookings_change failed [%]: %', v_sqlstate, v_sqlerrm;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
