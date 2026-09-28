-- ============================================================================
-- Tours "a demanda" (booking_approval_type='manual'): al aprobar una reserva
-- que no se cubrio de inmediato con wallet/puntos, el viajero tiene una
-- ventana para pagar. Sin una fecha limite ni nada que la vigile, un cupo
-- aprobado y nunca pagado se queda ocupando lugar indefinidamente.
--
-- Esta migracion:
--   1. Agrega bookings.payment_due_at (se llena desde approve-booking al
--      aprobar; NULL para el resto de las reservas, incluidas las de
--      aprobacion automatica).
--   2. expire_unpaid_approved_bookings(): mismo patron que
--      cleanup_abandoned_draft_bookings() (20260208044504) — funcion SQL
--      directa, sin Edge Function de por medio. Cancela lo vencido y notifica.
--      Reutiliza el tipo 'booking_cancelled' del enum original en vez de
--      agregar uno nuevo: un valor agregado con ALTER TYPE ... ADD VALUE no
--      se puede usar en la misma transaccion en la que se agrega, y
--      supabase db push aplica cada migracion como una sola transaccion.
--   3. cron cada 15 minutos. cleanup_abandoned_draft_bookings corre cada hora
--      porque su ventana es de 2h; esta es de 12h pero igual no conviene una
--      hora completa de margen, así que va mas seguido.
--
-- Liberar el cupo NO requiere tocar nada aqui: get_tour_availability y
-- create_booking_atomic cuentan en vivo excluyendo 'cancelled', y para tours
-- con slot_id el trigger trg_update_slot_booked_count recalcula
-- tour_slots.booked_count en cualquier UPDATE de status. Ambos reaccionan
-- solos en cuanto esta funcion cancela.
-- ============================================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_due_at timestamptz;

COMMENT ON COLUMN public.bookings.payment_due_at IS
  'Limite para completar el pago tras la aprobacion manual de la agencia. Lo pone approve-booking; NULL si nunca aplico (aprobacion automatica, o cubierta de inmediato con wallet/puntos).';

CREATE OR REPLACE FUNCTION public.expire_unpaid_approved_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_tour_name text;
  v_agency_owner_id uuid;
  v_count integer := 0;
BEGIN
  FOR v_booking IN
    SELECT b.id, b.user_id, b.tour_id, b.agency_id
    FROM bookings b
    WHERE b.approval_status = 'approved'
      AND b.status = 'pending'
      AND b.payment_status = 'pending'
      AND b.payment_due_at IS NOT NULL
      AND b.payment_due_at < now()
    FOR UPDATE OF b SKIP LOCKED
  LOOP
    UPDATE bookings
    SET status = 'cancelled',
        updated_at = now()
    WHERE id = v_booking.id;

    SELECT t.name INTO v_tour_name FROM tours t WHERE t.id = v_booking.tour_id;

    PERFORM create_notification(
      v_booking.user_id,
      'booking_cancelled',
      'Reserva cancelada por falta de pago',
      'Tu reserva para "' || COALESCE(v_tour_name, 'el tour') ||
        '" fue aprobada pero no se completo el pago dentro de las 12 horas, asi que se cancelo automaticamente.',
      jsonb_build_object('booking_id', v_booking.id, 'tour_id', v_booking.tour_id, 'reason', 'payment_expired')
    );

    v_agency_owner_id := get_agency_owner_id(v_booking.agency_id);
    IF v_agency_owner_id IS NOT NULL THEN
      PERFORM create_notification(
        v_agency_owner_id,
        'booking_cancelled',
        'Reserva cancelada por falta de pago',
        'La reserva que aprobaste para "' || COALESCE(v_tour_name, 'el tour') ||
          '" se cancelo: el viajero no completo el pago dentro de las 12 horas.',
        jsonb_build_object('booking_id', v_booking.id, 'tour_id', v_booking.tour_id, 'reason', 'payment_expired')
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_unpaid_approved_bookings TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-unpaid-approved-bookings') THEN
      PERFORM cron.unschedule('expire-unpaid-approved-bookings');
    END IF;
    PERFORM cron.schedule(
      'expire-unpaid-approved-bookings',
      '*/15 * * * *',
      'SELECT expire_unpaid_approved_bookings()'
    );
  END IF;
END $$;
