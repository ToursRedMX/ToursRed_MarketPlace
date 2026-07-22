CREATE OR REPLACE FUNCTION public.auto_accept_expired_slot_reschedules()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request record;
  v_response record;
  v_target_slot record;
  v_accepted_count integer;
  v_auto_accepted_count integer;
  v_processed_requests integer := 0;
  v_moved_bookings integer := 0;
  v_result jsonb;
BEGIN
  -- Procesar cada solicitud con deadline expirado y estado pendiente
  FOR v_request IN
    SELECT srr.*
    FROM slot_reschedule_requests srr
    WHERE srr.status = 'pending_responses'
    AND srr.response_deadline < now()
  LOOP
    -- Auto-aceptar todas las respuestas pendientes de esta solicitud
    UPDATE slot_reschedule_responses
    SET response = 'auto_accepted',
        responded_at = now()
    WHERE request_id = v_request.id
    AND response = 'pending';

    -- Actualizar bookings de respuestas auto-aceptadas
    UPDATE bookings b
    SET has_pending_slot_reschedule = false,
        slot_reschedule_response = 'auto_accepted',
        slot_reschedule_responded_at = now()
    FROM slot_reschedule_responses srr
    WHERE srr.request_id = v_request.id
    AND srr.booking_id = b.id
    AND b.has_pending_slot_reschedule = true
    AND b.slot_reschedule_response IS NULL;

    -- Contar aceptados y auto-aceptados para mover
    SELECT
      COUNT(*) FILTER (WHERE srr.response = 'accepted') as accepted,
      COUNT(*) FILTER (WHERE srr.response = 'auto_accepted') as auto_acc
    INTO v_accepted_count, v_auto_accepted_count
    FROM slot_reschedule_responses srr
    WHERE srr.request_id = v_request.id;

    -- Actualizar contadores en la solicitud
    UPDATE slot_reschedule_requests
    SET auto_accepted_count = v_auto_accepted_count,
        accepted_count = v_accepted_count
    WHERE id = v_request.id;

    -- Obtener datos del slot destino
    SELECT * INTO v_target_slot
    FROM tour_slots
    WHERE id = v_request.target_slot_id;

    IF v_target_slot IS NOT NULL THEN
      -- Mover reservas aceptadas y auto-aceptadas al slot destino
      UPDATE bookings b
      SET selected_date = v_target_slot.slot_date::text,
          selected_time = v_target_slot.departure_time
      FROM slot_reschedule_responses srr
      WHERE srr.request_id = v_request.id
      AND srr.booking_id = b.id
      AND srr.response IN ('accepted', 'auto_accepted')
      AND b.status IN ('confirmed', 'pending');

      GET DIAGNOSTICS v_moved_bookings = ROW_COUNT;

      -- Actualizar booked_count del slot destino
      UPDATE tour_slots
      SET booked_count = booked_count + (v_accepted_count + v_auto_accepted_count)
      WHERE id = v_request.target_slot_id;

      -- Cancelar el slot origen
      UPDATE tour_slots
      SET status = 'cancelado',
          cancellation_reason = 'Reagendado: ' || v_request.reason,
          cancelled_at = now()
      WHERE id = v_request.original_slot_id;
    END IF;

    -- Marcar la solicitud como completada
    UPDATE slot_reschedule_requests
    SET status = 'completed',
        completed_at = now()
    WHERE id = v_request.id;

    -- Crear notificaciones para viajeros auto-aceptados
    INSERT INTO notifications (user_id, type, title, message, data)
    SELECT
      srr.user_id,
      'slot_reschedule_auto_accepted',
      'Reagendamiento aceptado automaticamente',
      'Tu reserva fue movida automaticamente al nuevo horario ya que no respondiste a tiempo.',
      jsonb_build_object(
        'request_id', v_request.id,
        'booking_id', srr.booking_id,
        'new_slot_date', v_target_slot.slot_date,
        'new_departure_time', v_target_slot.departure_time
      )
    FROM slot_reschedule_responses srr
    WHERE srr.request_id = v_request.id
    AND srr.response = 'auto_accepted';

    v_processed_requests := v_processed_requests + 1;
  END LOOP;

  -- Tambien completar solicitudes donde todos ya respondieron (sin importar deadline)
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
    -- Obtener datos del slot destino
    SELECT * INTO v_target_slot
    FROM tour_slots
    WHERE id = v_request.target_slot_id;

    IF v_target_slot IS NOT NULL THEN
      -- Mover reservas aceptadas al slot destino
      UPDATE bookings b
      SET selected_date = v_target_slot.slot_date::text,
          selected_time = v_target_slot.departure_time
      FROM slot_reschedule_responses srr
      WHERE srr.request_id = v_request.id
      AND srr.booking_id = b.id
      AND srr.response = 'accepted'
      AND b.status IN ('confirmed', 'pending');

      -- Actualizar booked_count del slot destino
      SELECT COUNT(*) INTO v_accepted_count
      FROM slot_reschedule_responses
      WHERE request_id = v_request.id AND response = 'accepted';

      IF v_accepted_count > 0 THEN
        UPDATE tour_slots
        SET booked_count = booked_count + v_accepted_count
        WHERE id = v_request.target_slot_id;
      END IF;

      -- Verificar si quedan bookings activos en el slot origen
      DECLARE
        v_remaining_bookings integer;
      BEGIN
        SELECT COUNT(*) INTO v_remaining_bookings
        FROM slot_reschedule_responses srr
        WHERE srr.request_id = v_request.id
        AND srr.response != 'rejected';

        -- Solo cancelar el slot origen si todos rechazaron o no quedan reservas activas
        IF v_remaining_bookings = 0 OR NOT EXISTS (
          SELECT 1 FROM bookings b
          JOIN slot_reschedule_responses srr ON srr.booking_id = b.id
          WHERE srr.request_id = v_request.id
          AND b.status IN ('confirmed', 'pending')
          AND b.selected_date = (SELECT slot_date::text FROM tour_slots WHERE id = v_request.original_slot_id)
        ) THEN
          UPDATE tour_slots
          SET status = 'cancelado',
              cancellation_reason = 'Reagendado: ' || v_request.reason,
              cancelled_at = now()
          WHERE id = v_request.original_slot_id;
        END IF;
      END;
    END IF;

    UPDATE slot_reschedule_requests
    SET status = 'completed',
        completed_at = now()
    WHERE id = v_request.id;

    v_processed_requests := v_processed_requests + 1;
  END LOOP;

  v_result := jsonb_build_object(
    'processed_requests', v_processed_requests,
    'moved_bookings', v_moved_bookings
  );

  RETURN v_result;
END;
$$;

-- Programar el cron job para ejecutar cada hora
SELECT cron.schedule(
  'auto-accept-expired-slot-reschedules',
  '0 * * * *',
  $$SELECT public.auto_accept_expired_slot_reschedules()$$
);
