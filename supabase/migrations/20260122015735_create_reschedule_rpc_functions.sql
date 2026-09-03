
-- Función para obtener reagendamiento pendiente de una reserva
CREATE OR REPLACE FUNCTION get_pending_reschedule_for_booking(p_booking_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  -- Obtener información del reagendamiento pendiente
  SELECT json_build_object(
    'reschedule', json_build_object(
      'id', tr.id,
      'tour_id', tr.tour_id,
      'tour_name', t.name,
      'original_start_date', tr.original_start_date,
      'original_end_date', tr.original_end_date,
      'new_start_date', tr.new_start_date,
      'new_end_date', tr.new_end_date,
      'reason', tr.reason,
      'response_deadline', tr.response_deadline,
      'created_at', tr.created_at
    ),
    'response', json_build_object(
      'id', brr.id,
      'response', brr.response,
      'responded_at', brr.responded_at,
      'notification_sent', brr.notification_sent,
      'email_sent', brr.email_sent
    )
  ) INTO v_result
  FROM booking_reschedule_responses brr
  INNER JOIN tour_reschedules tr ON brr.tour_reschedule_id = tr.id
  INNER JOIN tours t ON tr.tour_id = t.id
  WHERE brr.booking_id = p_booking_id
    AND brr.response = 'pending'
    AND tr.status = 'pending_responses'
    AND tr.response_deadline > now()
  ORDER BY tr.created_at DESC
  LIMIT 1;

  RETURN v_result;
END;
$$;

-- Función para obtener resumen de respuestas a un reagendamiento
CREATE OR REPLACE FUNCTION get_reschedule_summary_for_tour(p_tour_reschedule_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'total', COUNT(*),
    'pending', COUNT(*) FILTER (WHERE response = 'pending'),
    'accepted', COUNT(*) FILTER (WHERE response = 'accepted'),
    'rejected', COUNT(*) FILTER (WHERE response = 'rejected'),
    'auto_accepted', COUNT(*) FILTER (WHERE response = 'auto_accepted'),
    'responses', json_agg(
      json_build_object(
        'booking_id', brr.booking_id,
        'booking_code', b.booking_code,
        'user_name', u.first_name || ' ' || u.last_name,
        'user_email', u.email,
        'response', brr.response,
        'responded_at', brr.responded_at
      ) ORDER BY brr.created_at
    )
  ) INTO v_result
  FROM booking_reschedule_responses brr
  INNER JOIN bookings b ON brr.booking_id = b.id
  INNER JOIN users u ON brr.user_id = u.id
  WHERE brr.tour_reschedule_id = p_tour_reschedule_id;

  RETURN v_result;
END;
$$;

-- Función para auto-aceptar reagendamientos expirados
CREATE OR REPLACE FUNCTION auto_accept_expired_reschedules()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_response RECORD;
BEGIN
  -- Actualizar respuestas pendientes que pasaron la fecha límite
  FOR v_response IN
    SELECT brr.id, brr.booking_id, brr.user_id, tr.new_start_date
    FROM booking_reschedule_responses brr
    INNER JOIN tour_reschedules tr ON brr.tour_reschedule_id = tr.id
    WHERE brr.response = 'pending'
      AND tr.response_deadline < now()
      AND tr.status = 'pending_responses'
  LOOP
    -- Actualizar respuesta a auto_accepted
    UPDATE booking_reschedule_responses
    SET 
      response = 'auto_accepted',
      responded_at = now()
    WHERE id = v_response.id;

    -- Actualizar booking
    UPDATE bookings
    SET 
      has_pending_reschedule = false,
      reschedule_response = 'auto_accepted',
      reschedule_responded_at = now(),
      booking_date = v_response.new_start_date
    WHERE id = v_response.booking_id;

    -- Crear notificación
    INSERT INTO notifications (user_id, type, title, message, data)
    VALUES (
      v_response.user_id,
      'tour_updated',
      'Reagendamiento Auto-Aceptado',
      'Tu reserva fue actualizada automáticamente a la nueva fecha por no responder en el plazo establecido.',
      json_build_object('booking_id', v_response.booking_id)
    );

    v_count := v_count + 1;
  END LOOP;

  -- Actualizar estado de reagendamientos completados
  UPDATE tour_reschedules
  SET status = 'completed'
  WHERE id IN (
    SELECT DISTINCT tour_reschedule_id
    FROM booking_reschedule_responses
    WHERE tour_reschedule_id IN (
      SELECT id FROM tour_reschedules WHERE status = 'pending_responses'
    )
    GROUP BY tour_reschedule_id
    HAVING COUNT(*) FILTER (WHERE response = 'pending') = 0
  );

  RETURN v_count;
END;
$$;

-- Comentarios en las funciones
COMMENT ON FUNCTION get_pending_reschedule_for_booking IS 'Obtiene información del reagendamiento pendiente para una reserva';
COMMENT ON FUNCTION get_reschedule_summary_for_tour IS 'Obtiene resumen de respuestas a un reagendamiento de tour';
COMMENT ON FUNCTION auto_accept_expired_reschedules IS 'Auto-acepta reagendamientos que pasaron la fecha límite sin respuesta';
