-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260328000317
--   name:    20260327_fix_auto_accept_slot_reschedules_with_priority
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
  # Auto-accept con prioridad por orden de reserva y reembolso automático

  ## Descripción
  Reemplaza la función auto_accept_expired_slot_reschedules para implementar:

  1. Orden de prioridad para asignación de cupos:
     - Primero: quienes ya aceptaron manualmente (confirmed_spot = true)
     - Segundo: quienes no respondieron, ordenados por booking_created_at ASC (quien reservó primero tiene prioridad)

  2. Para quienes no alcanzan cupo:
     - Marcar como 'auto_accepted_no_availability'
     - Procesar reembolso del 100% al monedero ToursRed Cash automáticamente
     - Cancelar la reserva
     - Enviar notificación explicativa

  3. Para quienes sí alcanzan cupo:
     - Marcar como 'auto_accepted' y confirmed_spot = true
     - Mover la reserva al slot destino

  ## Seguridad
  - SECURITY DEFINER para operar sin restricciones de RLS
*/

CREATE OR REPLACE FUNCTION public.auto_accept_expired_slot_reschedules()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request record
;


  v_response record
;


  v_target_slot record
;


  v_booking record
;


  v_processed_requests integer := 0
;


  v_moved_bookings integer := 0
;


  v_refunded_bookings integer := 0
;


  v_result jsonb
;


  v_confirmed_travelers integer
;


  v_available_spots integer
;


  v_travelers_this_booking integer
;


  v_refund_amount numeric
;


  v_now timestamptz
;


BEGIN
  v_now := now()
;



  FOR v_request IN
    SELECT srr.*
    FROM slot_reschedule_requests srr
    WHERE srr.status = 'pending_responses'
    AND srr.response_deadline < v_now
  LOOP
    SELECT * INTO v_target_slot
    FROM tour_slots
    WHERE id = v_request.target_slot_id
;



    IF v_target_slot IS NULL THEN
      UPDATE slot_reschedule_requests
      SET status = 'completed', completed_at = v_now
      WHERE id = v_request.id
;


      CONTINUE
;


    END IF
;



    v_available_spots := COALESCE(v_request.available_spots_in_target, v_target_slot.capacity - v_target_slot.booked_count)
;



    SELECT COALESCE(SUM(b.travelers_count), 0)
    INTO v_confirmed_travelers
    FROM slot_reschedule_responses srr2
    JOIN bookings b ON b.id = srr2.booking_id
    WHERE srr2.request_id = v_request.id
    AND srr2.confirmed_spot = true
    AND b.status IN ('confirmed', 'pending')
;



    FOR v_response IN
      SELECT srr2.*, b.travelers_count, b.deposit_amount, b.toursred_cash_used,
             b.user_id AS booking_user_id, b.status AS booking_status
      FROM slot_reschedule_responses srr2
      JOIN bookings b ON b.id = srr2.booking_id
      WHERE srr2.request_id = v_request.id
      AND srr2.response = 'pending'
      AND b.status IN ('confirmed', 'pending')
      ORDER BY srr2.booking_created_at ASC NULLS LAST, srr2.created_at ASC
    LOOP
      v_travelers_this_booking := COALESCE(v_response.travelers_count, 1)
;



      IF (v_available_spots - v_confirmed_travelers) >= v_travelers_this_booking THEN
        UPDATE slot_reschedule_responses
        SET response = 'auto_accepted',
            responded_at = v_now,
            confirmed_spot = true
        WHERE id = v_response.id
;



        UPDATE bookings
        SET has_pending_slot_reschedule = false,
            slot_reschedule_response = 'auto_accepted',
            slot_reschedule_responded_at = v_now,
            selected_date = v_target_slot.slot_date::text,
            selected_time = v_target_slot.departure_time,
            slot_id = v_target_slot.id
        WHERE id = v_response.booking_id
;



        v_confirmed_travelers := v_confirmed_travelers + v_travelers_this_booking
;


        v_moved_bookings := v_moved_bookings + 1
;



        INSERT INTO notifications (user_id, type, title, message, data)
        VALUES (
          v_response.booking_user_id,
          'slot_reschedule_auto_accepted',
          'Reagendamiento aceptado automaticamente',
          'Tu reserva fue movida automaticamente al nuevo horario ya que no respondiste a tiempo.',
          jsonb_build_object(
            'request_id', v_request.id,
            'booking_id', v_response.booking_id,
            'new_slot_date', v_target_slot.slot_date,
            'new_departure_time', v_target_slot.departure_time
          )
        )
;



      ELSE
        v_refund_amount := COALESCE(v_response.deposit_amount, 0) + COALESCE(v_response.toursred_cash_used, 0)
;



        UPDATE slot_reschedule_responses
        SET response = 'auto_accepted_no_availability',
            responded_at = v_now,
            confirmed_spot = false,
            refund_processed = true,
            refund_amount = v_refund_amount
        WHERE id = v_response.id
;



        UPDATE bookings
        SET status = 'cancelled',
            cancelled_at = v_now,
            cancellation_type = 'slot_reschedule_no_availability',
            cancellation_refund_amount = v_refund_amount,
            has_pending_slot_reschedule = false,
            slot_reschedule_response = 'auto_accepted_no_availability',
            slot_reschedule_responded_at = v_now
        WHERE id = v_response.booking_id
;



        IF v_refund_amount > 0 THEN
          PERFORM update_wallet_balance(
            v_response.booking_user_id,
            v_refund_amount,
            'refund',
            'Reembolso automatico: sin cupo disponible en reagendado de slot',
            v_response.booking_id,
            'slot_reschedule_no_availability'
          )
;


        END IF
;



        v_refunded_bookings := v_refunded_bookings + 1
;



        INSERT INTO notifications (user_id, type, title, message, data)
        VALUES (
          v_response.booking_user_id,
          'slot_reschedule_no_availability',
          'Sin cupo disponible - Reembolso procesado',
          'No habia cupo disponible en el nuevo horario para tu reserva. Se ha procesado un reembolso del 100% a tu ToursRed Cash.',
          jsonb_build_object(
            'request_id', v_request.id,
            'booking_id', v_response.booking_id,
            'refund_amount', v_refund_amount,
            'original_slot_date', (SELECT slot_date FROM tour_slots WHERE id = v_request.original_slot_id),
            'original_departure_time', (SELECT departure_time FROM tour_slots WHERE id = v_request.original_slot_id)
          )
        )
;


      END IF
;


    END LOOP
;



    UPDATE tour_slots
    SET booked_count = (
      SELECT COALESCE(SUM(b.travelers_count), 0)
      FROM slot_reschedule_responses srr2
      JOIN bookings b ON b.id = srr2.booking_id
      WHERE srr2.request_id = v_request.id
      AND srr2.confirmed_spot = true
      AND b.status IN ('confirmed', 'pending')
    )
    WHERE id = v_request.target_slot_id
    AND (
      SELECT COALESCE(SUM(b.travelers_count), 0)
      FROM slot_reschedule_responses srr2
      JOIN bookings b ON b.id = srr2.booking_id
      WHERE srr2.request_id = v_request.id
      AND srr2.confirmed_spot = true
      AND b.status IN ('confirmed', 'pending')
    ) > 0
;



    UPDATE tour_slots
    SET status = 'cancelado',
        cancellation_reason = 'Reagendado: ' || v_request.reason,
        cancelled_at = v_now
    WHERE id = v_request.original_slot_id
;



    UPDATE slot_reschedule_requests
    SET status = 'completed',
        completed_at = v_now,
        auto_accepted_count = (
          SELECT COUNT(*) FROM slot_reschedule_responses
          WHERE request_id = v_request.id AND response = 'auto_accepted'
        ),
        accepted_count = (
          SELECT COUNT(*) FROM slot_reschedule_responses
          WHERE request_id = v_request.id AND response = 'accepted'
        ),
        rejected_count = (
          SELECT COUNT(*) FROM slot_reschedule_responses
          WHERE request_id = v_request.id AND response IN ('rejected', 'auto_accepted_no_availability', 'accepted_no_availability')
        ),
        no_availability_count = (
          SELECT COUNT(*) FROM slot_reschedule_responses
          WHERE request_id = v_request.id AND response IN ('auto_accepted_no_availability', 'accepted_no_availability')
        )
    WHERE id = v_request.id
;



    v_processed_requests := v_processed_requests + 1
;


  END LOOP
;



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
    SELECT * INTO v_target_slot
    FROM tour_slots
    WHERE id = v_request.target_slot_id
;



    IF v_target_slot IS NOT NULL THEN
      UPDATE tour_slots
      SET booked_count = (
        SELECT COALESCE(SUM(b.travelers_count), 0)
        FROM slot_reschedule_responses srr2
        JOIN bookings b ON b.id = srr2.booking_id
        WHERE srr2.request_id = v_request.id
        AND srr2.confirmed_spot = true
        AND b.status IN ('confirmed', 'pending')
      )
      WHERE id = v_request.target_slot_id
      AND (
        SELECT COALESCE(SUM(b.travelers_count), 0)
        FROM slot_reschedule_responses srr2
        JOIN bookings b ON b.id = srr2.booking_id
        WHERE srr2.request_id = v_request.id
        AND srr2.confirmed_spot = true
        AND b.status IN ('confirmed', 'pending')
      ) > 0
;



      IF NOT EXISTS (
        SELECT 1 FROM bookings b
        JOIN slot_reschedule_responses srr2 ON srr2.booking_id = b.id
        WHERE srr2.request_id = v_request.id
        AND b.status IN ('confirmed', 'pending')
        AND b.selected_date = (SELECT slot_date::text FROM tour_slots WHERE id = v_request.original_slot_id)
      ) THEN
        UPDATE tour_slots
        SET status = 'cancelado',
            cancellation_reason = 'Reagendado: ' || v_request.reason,
            cancelled_at = v_now
        WHERE id = v_request.original_slot_id
;


      END IF
;


    END IF
;



    UPDATE slot_reschedule_requests
    SET status = 'completed',
        completed_at = v_now,
        accepted_count = (
          SELECT COUNT(*) FROM slot_reschedule_responses
          WHERE request_id = v_request.id AND response IN ('accepted')
        ),
        rejected_count = (
          SELECT COUNT(*) FROM slot_reschedule_responses
          WHERE request_id = v_request.id AND response IN ('rejected', 'auto_accepted_no_availability', 'accepted_no_availability')
        ),
        no_availability_count = (
          SELECT COUNT(*) FROM slot_reschedule_responses
          WHERE request_id = v_request.id AND response IN ('auto_accepted_no_availability', 'accepted_no_availability')
        )
    WHERE id = v_request.id
;



    v_processed_requests := v_processed_requests + 1
;


  END LOOP
;



  v_result := jsonb_build_object(
    'processed_requests', v_processed_requests,
    'moved_bookings', v_moved_bookings,
    'refunded_bookings', v_refunded_bookings
  )
;



  RETURN v_result
;


END
;


$$
;



;
