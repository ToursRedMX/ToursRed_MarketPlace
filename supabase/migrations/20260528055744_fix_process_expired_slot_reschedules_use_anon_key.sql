
CREATE OR REPLACE FUNCTION public.process_expired_slot_reschedules()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request            record;
  v_response           record;
  v_booking            record;
  v_target_slot        record;
  v_target_slot2       record;
  v_total_refund       numeric(10,2);
  v_accepted_count     integer;
  v_processed_requests integer := 0;
  v_cancelled_bookings integer := 0;
  v_result             jsonb;
  -- URL y anon key son publicos, no son secretos
  v_supabase_url       text := 'https://huzsedewwzjywcpbkjkm.supabase.co';
  v_anon_key           text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1enNlZGV3d3pqeXdjcGJramttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwODY3ODksImV4cCI6MjA2MjY2Mjc4OX0.Jrfg9m4qwtIRHKhJ15hV_bqqWCDOYYeX-y1Kt34DGQk';
  v_request_id         bigint;
BEGIN
  -- -----------------------------------------------------------------------
  -- Paso 1: Solicitudes con deadline expirado
  -- -----------------------------------------------------------------------
  FOR v_request IN
    SELECT srr.*
    FROM slot_reschedule_requests srr
    WHERE srr.status = 'pending_responses'
    AND srr.response_deadline < now()
  LOOP

    FOR v_response IN
      SELECT r.*
      FROM slot_reschedule_responses r
      WHERE r.request_id = v_request.id
      AND r.response = 'pending'
    LOOP

      SELECT b.id, b.deposit_amount, b.toursred_cash_used, b.user_id, b.travelers_count, b.agency_id
      INTO v_booking
      FROM bookings b
      WHERE b.id = v_response.booking_id
      AND b.status IN ('confirmed', 'pending');

      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      v_total_refund := COALESCE(v_booking.deposit_amount, 0) + COALESCE(v_booking.toursred_cash_used, 0);

      IF v_total_refund > 0 THEN
        PERFORM public.update_wallet_balance(
          p_user_id        => v_booking.user_id,
          p_amount         => v_total_refund,
          p_type           => 'refund'::toursred_cash_transaction_type,
          p_description    => 'Reembolso por reagendamiento no respondido a tiempo',
          p_reference_id   => v_booking.id,
          p_reference_type => 'slot_reschedule_no_response'
        );
      END IF;

      UPDATE bookings
      SET
        status                       = 'cancelled',
        cancelled_at                 = now(),
        cancellation_type            = 'slot_reschedule_no_response',
        cancellation_refund_amount   = v_total_refund,
        has_pending_slot_reschedule  = false,
        slot_reschedule_response     = 'auto_cancelled',
        slot_reschedule_responded_at = now()
      WHERE id = v_booking.id;

      UPDATE slot_reschedule_responses
      SET
        response         = 'auto_cancelled',
        confirmed_spot   = false,
        responded_at     = now(),
        refund_processed = true,
        refund_amount    = v_total_refund
      WHERE id = v_response.id;

      UPDATE tour_slots
      SET booked_count = GREATEST(0, booked_count - COALESCE(v_booking.travelers_count, 1))
      WHERE id = v_request.original_slot_id;

      INSERT INTO notifications (user_id, type, title, message, data)
      VALUES (
        v_booking.user_id,
        'slot_reschedule_auto_cancelled'::notification_type,
        'Tu reserva fue cancelada automaticamente',
        CASE
          WHEN v_total_refund > 0
          THEN 'La agencia propuso un nuevo horario al que no respondiste a tiempo. Tu deposito de $' ||
               v_total_refund::text || ' fue reembolsado a tu ToursRed Cash.'
          ELSE 'La agencia propuso un nuevo horario al que no respondiste a tiempo. Tu reserva fue cancelada sin costo.'
        END,
        jsonb_build_object(
          'request_id',    v_request.id,
          'booking_id',    v_booking.id,
          'refund_amount', v_total_refund
        )
      );

      -- Email al viajero (verify_jwt=false, anon key es suficiente)
      SELECT INTO v_request_id net.http_post(
        url     := v_supabase_url || '/functions/v1/send-slot-reschedule-auto-cancelled-traveler',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || v_anon_key
        ),
        body    := jsonb_build_object(
          'booking_id',    v_booking.id,
          'refund_amount', v_total_refund
        ),
        timeout_milliseconds := 10000
      );

      -- Email a la agencia (verify_jwt=false, anon key es suficiente)
      SELECT INTO v_request_id net.http_post(
        url     := v_supabase_url || '/functions/v1/send-slot-reschedule-auto-cancelled-agency',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || v_anon_key
        ),
        body    := jsonb_build_object(
          'booking_id',    v_booking.id,
          'refund_amount', v_total_refund
        ),
        timeout_milliseconds := 10000
      );

      v_cancelled_bookings := v_cancelled_bookings + 1;
    END LOOP;

    UPDATE slot_reschedule_requests
    SET
      auto_accepted_count = 0,
      accepted_count = (
        SELECT COUNT(*) FROM slot_reschedule_responses
        WHERE request_id = v_request.id AND response = 'accepted'
      ),
      rejected_count = (
        SELECT COUNT(*) FROM slot_reschedule_responses
        WHERE request_id = v_request.id AND response IN ('rejected', 'auto_cancelled')
      )
    WHERE id = v_request.id;

    SELECT * INTO v_target_slot FROM tour_slots WHERE id = v_request.target_slot_id;

    IF v_target_slot IS NOT NULL THEN
      UPDATE bookings b
      SET
        selected_date = v_target_slot.slot_date,
        selected_time = v_target_slot.departure_time
      FROM slot_reschedule_responses srr
      WHERE srr.request_id = v_request.id
      AND srr.booking_id = b.id
      AND srr.response = 'accepted'
      AND srr.confirmed_spot = true
      AND b.status IN ('confirmed', 'pending')
      AND (b.selected_date IS DISTINCT FROM v_target_slot.slot_date
           OR b.selected_time IS DISTINCT FROM v_target_slot.departure_time);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM bookings b
      JOIN slot_reschedule_responses srr ON srr.booking_id = b.id
      WHERE srr.request_id = v_request.id
      AND b.status IN ('confirmed', 'pending')
      AND b.selected_date = (SELECT slot_date FROM tour_slots WHERE id = v_request.original_slot_id)
    ) THEN
      UPDATE tour_slots
      SET
        status              = 'cancelado',
        cancellation_reason = 'Reagendado: ' || v_request.reason,
        cancelled_at        = now()
      WHERE id = v_request.original_slot_id
      AND status <> 'cancelado';
    END IF;

    UPDATE slot_reschedule_requests
    SET status = 'completed', completed_at = now()
    WHERE id = v_request.id;

    v_processed_requests := v_processed_requests + 1;
  END LOOP;

  -- -----------------------------------------------------------------------
  -- Paso 2: Solicitudes donde todos ya respondieron voluntariamente
  -- -----------------------------------------------------------------------
  FOR v_request IN
    SELECT srr.*
    FROM slot_reschedule_requests srr
    WHERE srr.status = 'pending_responses'
    AND NOT EXISTS (
      SELECT 1 FROM slot_reschedule_responses r
      WHERE r.request_id = srr.id
      AND r.response = 'pending'
    )
  LOOP
    SELECT * INTO v_target_slot2 FROM tour_slots WHERE id = v_request.target_slot_id;

    IF v_target_slot2 IS NOT NULL THEN
      UPDATE bookings b
      SET
        selected_date = v_target_slot2.slot_date,
        selected_time = v_target_slot2.departure_time
      FROM slot_reschedule_responses srr
      WHERE srr.request_id = v_request.id
      AND srr.booking_id = b.id
      AND srr.response = 'accepted'
      AND srr.confirmed_spot = true
      AND b.status IN ('confirmed', 'pending')
      AND (b.selected_date IS DISTINCT FROM v_target_slot2.slot_date
           OR b.selected_time IS DISTINCT FROM v_target_slot2.departure_time);

      SELECT COUNT(*) INTO v_accepted_count
      FROM slot_reschedule_responses
      WHERE request_id = v_request.id AND response = 'accepted';

      IF NOT EXISTS (
        SELECT 1 FROM bookings b
        JOIN slot_reschedule_responses srr ON srr.booking_id = b.id
        WHERE srr.request_id = v_request.id
        AND b.status IN ('confirmed', 'pending')
        AND b.selected_date = (SELECT slot_date FROM tour_slots WHERE id = v_request.original_slot_id)
      ) THEN
        UPDATE tour_slots
        SET
          status              = 'cancelado',
          cancellation_reason = 'Reagendado: ' || v_request.reason,
          cancelled_at        = now()
        WHERE id = v_request.original_slot_id
        AND status <> 'cancelado';
      END IF;
    END IF;

    UPDATE slot_reschedule_requests
    SET status = 'completed', completed_at = now()
    WHERE id = v_request.id;

    v_processed_requests := v_processed_requests + 1;
  END LOOP;

  v_result := jsonb_build_object(
    'processed_requests', v_processed_requests,
    'cancelled_bookings', v_cancelled_bookings
  );

  RETURN v_result;
END;
$$;
