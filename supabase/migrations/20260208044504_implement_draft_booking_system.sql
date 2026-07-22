
-- 1. Add 'draft' to bookings status constraint
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'pending'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text]));

-- 2. Update get_tour_availability to exclude draft and pending-unapproved bookings
DROP FUNCTION IF EXISTS get_tour_availability(uuid);

CREATE OR REPLACE FUNCTION get_tour_availability(p_tour_id uuid)
RETURNS TABLE (
  available_spots integer,
  max_capacity integer,
  total_booked integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    GREATEST(
      0,
      COALESCE(
        CASE
          WHEN t.available_spots IS NOT NULL AND t.available_spots > 0
          THEN t.available_spots
          ELSE COALESCE(t.max_travelers, 10)
        END,
        10
      ) - COALESCE(SUM(b.travelers_count), 0)
    )::integer as available_spots,
    COALESCE(
      CASE
        WHEN t.available_spots IS NOT NULL AND t.available_spots > 0
        THEN t.available_spots
        ELSE COALESCE(t.max_travelers, 10)
      END,
      10
    )::integer as max_capacity,
    COALESCE(SUM(b.travelers_count), 0)::integer as total_booked
  FROM tours t
  LEFT JOIN bookings b
    ON b.tour_id = t.id
    AND (
      b.status = 'confirmed'
      OR (b.status = 'pending' AND b.approval_status = 'approved')
    )
  WHERE t.id = p_tour_id
  GROUP BY t.id, t.available_spots, t.max_travelers;
END;
$$;

GRANT EXECUTE ON FUNCTION get_tour_availability TO authenticated;
GRANT EXECUTE ON FUNCTION get_tour_availability TO anon;

-- 3. Update notification trigger to skip draft bookings
CREATE OR REPLACE FUNCTION handle_booking_approval_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  agency_owner_id uuid;
  tour_name text;
  user_name text;
BEGIN
  IF NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.approval_status != NEW.approval_status) THEN
    SELECT t.name INTO tour_name
    FROM tours t
    WHERE t.id = NEW.tour_id;

    SELECT COALESCE(u.first_name || ' ' || u.last_name, u.email) INTO user_name
    FROM users u
    WHERE u.id = NEW.user_id;

    agency_owner_id := get_agency_owner_id(NEW.agency_id);

    IF agency_owner_id IS NOT NULL THEN
      IF NEW.approval_status = 'pending' AND TG_OP = 'INSERT' THEN
        PERFORM create_notification(
          agency_owner_id,
          'booking_pending_approval',
          'Nueva reserva pendiente de aprobacion',
          user_name || ' ha solicitado una reserva para "' || tour_name || '" que requiere tu aprobacion.',
          jsonb_build_object(
            'booking_id', NEW.id,
            'tour_id', NEW.tour_id,
            'user_id', NEW.user_id,
            'tour_name', tour_name,
            'user_name', user_name,
            'travelers_count', NEW.travelers_count,
            'booking_date', NEW.booking_date
          )
        );

      ELSIF NEW.approval_status = 'approved' AND OLD.approval_status = 'pending' THEN
        PERFORM create_notification(
          NEW.user_id,
          'booking_approved',
          'Reserva aprobada',
          'Tu reserva para "' || tour_name || '" ha sido aprobada. Ahora puedes proceder con el pago.',
          jsonb_build_object(
            'booking_id', NEW.id,
            'tour_id', NEW.tour_id,
            'tour_name', tour_name
          )
        );

      ELSIF NEW.approval_status = 'rejected' AND OLD.approval_status = 'pending' THEN
        PERFORM create_notification(
          NEW.user_id,
          'booking_rejected',
          'Reserva rechazada',
          'Tu reserva para "' || tour_name || '" ha sido rechazada.' ||
          CASE WHEN NEW.approval_notes IS NOT NULL THEN ' Motivo: ' || NEW.approval_notes ELSE '' END,
          jsonb_build_object(
            'booking_id', NEW.id,
            'tour_id', NEW.tour_id,
            'tour_name', tour_name,
            'rejection_reason', NEW.approval_notes
          )
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Create activate_draft_booking function (atomic availability check + status transition)
CREATE OR REPLACE FUNCTION activate_draft_booking(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_max_capacity integer;
  v_total_booked integer;
  v_available integer;
BEGIN
  SELECT b.id, b.status, b.tour_id, b.travelers_count, b.approval_status
  INTO v_booking
  FROM bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF v_booking IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Reserva no encontrada');
  END IF;

  IF v_booking.status != 'draft' THEN
    RETURN jsonb_build_object('success', true, 'message', 'La reserva ya fue activada');
  END IF;

  SELECT
    COALESCE(
      CASE
        WHEN t.available_spots IS NOT NULL AND t.available_spots > 0
        THEN t.available_spots
        ELSE COALESCE(t.max_travelers, 10)
      END,
      10
    ),
    COALESCE(SUM(ob.travelers_count), 0)::integer
  INTO v_max_capacity, v_total_booked
  FROM tours t
  LEFT JOIN bookings ob
    ON ob.tour_id = t.id
    AND ob.id != p_booking_id
    AND (
      ob.status = 'confirmed'
      OR (ob.status = 'pending' AND ob.approval_status = 'approved')
    )
  WHERE t.id = v_booking.tour_id
  GROUP BY t.id, t.available_spots, t.max_travelers;

  v_available := v_max_capacity - v_total_booked;

  IF v_booking.travelers_count > v_available THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No hay suficientes lugares disponibles',
      'available_spots', v_available,
      'requested', v_booking.travelers_count
    );
  END IF;

  UPDATE bookings
  SET status = 'pending',
      updated_at = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object('success', true, 'available_spots', v_available - v_booking.travelers_count);
END;
$$;

GRANT EXECUTE ON FUNCTION activate_draft_booking TO authenticated;

-- 5. Create cleanup function for abandoned draft bookings
CREATE OR REPLACE FUNCTION cleanup_abandoned_draft_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  DELETE FROM booking_travelers
  WHERE booking_id IN (
    SELECT id FROM bookings
    WHERE status = 'draft'
    AND created_at < now() - interval '2 hours'
  );

  DELETE FROM bookings
  WHERE status = 'draft'
  AND created_at < now() - interval '2 hours';

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN v_deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION cleanup_abandoned_draft_bookings TO service_role;

-- 6. Set up pg_cron to run cleanup every hour (if extension available)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-draft-bookings') THEN
      PERFORM cron.unschedule('cleanup-draft-bookings');
    END IF;
    PERFORM cron.schedule(
      'cleanup-draft-bookings',
      '0 * * * *',
      'SELECT cleanup_abandoned_draft_bookings()'
    );
  END IF;
END $$;
