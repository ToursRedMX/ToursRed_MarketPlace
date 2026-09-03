
ALTER TABLE commission_records 
DROP CONSTRAINT IF EXISTS commission_records_status_check;

ALTER TABLE commission_records 
ADD CONSTRAINT commission_records_status_check 
CHECK (status = ANY (ARRAY['pending'::text, 'processed'::text, 'paid_out'::text, 'disputed'::text, 'voided'::text]));

UPDATE commission_records cr
SET status = 'voided'
FROM bookings b
WHERE cr.booking_id = b.id
  AND b.status = 'cancelled'
  AND cr.status = 'pending';

CREATE OR REPLACE FUNCTION public.cancel_commissions_on_booking_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    UPDATE commission_records
    SET status = 'voided'
    WHERE booking_id = NEW.id
      AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_commissions_on_booking_cancel ON bookings;

CREATE TRIGGER trg_cancel_commissions_on_booking_cancel
  AFTER UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.cancel_commissions_on_booking_cancel();
