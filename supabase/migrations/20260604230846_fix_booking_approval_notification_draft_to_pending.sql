
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
  -- Skip pure draft inserts (no notification yet)
  IF TG_OP = 'INSERT' AND NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- Fire on:
  --   1. Non-draft INSERT (legacy path, just in case)
  --   2. UPDATE where approval_status changed
  --   3. UPDATE where booking just activated from draft → pending
  IF NOT (
    (TG_OP = 'INSERT') OR
    (TG_OP = 'UPDATE' AND OLD.approval_status IS DISTINCT FROM NEW.approval_status) OR
    (TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'pending')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT t.name INTO tour_name
  FROM tours t
  WHERE t.id = NEW.tour_id;

  SELECT COALESCE(u.first_name || ' ' || u.last_name, u.email) INTO user_name
  FROM users u
  WHERE u.id = NEW.user_id;

  agency_owner_id := get_agency_owner_id(NEW.agency_id);

  IF agency_owner_id IS NOT NULL THEN
    -- Nueva reserva activada (draft→pending) o INSERT no-draft con approval pending
    IF NEW.approval_status = 'pending' AND (
      (TG_OP = 'INSERT') OR
      (TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'pending')
    ) THEN
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

  RETURN NEW;
END;
$$;
