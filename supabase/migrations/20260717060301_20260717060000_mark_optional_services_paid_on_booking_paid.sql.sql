-- When a booking transitions to paid (paid_at goes from NULL to non-NULL),
-- automatically mark all its checkout-included optional services as paid.
-- This covers Stripe checkout, manual approval, and payment plan completion.
-- Post-booking extras already have paid_at set and are skipped.

CREATE OR REPLACE FUNCTION public.mark_optional_services_paid_on_booking_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL) THEN
    UPDATE public.booking_optional_services
    SET
      paid_at = NEW.paid_at,
      payment_method = COALESCE(NEW.payment_method, 'Tarjeta'),
      total_paid = subtotal
    WHERE booking_id = NEW.id
      AND paid_at IS NULL
      AND is_cancelled = false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_optional_services_paid ON public.bookings;
CREATE TRIGGER trg_mark_optional_services_paid
  AFTER UPDATE OF paid_at ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.mark_optional_services_paid_on_booking_paid();

-- Backfill: mark optional services as paid for bookings that are already paid
UPDATE public.booking_optional_services bos
SET
  paid_at = b.paid_at,
  payment_method = COALESCE(b.payment_method, 'Tarjeta'),
  total_paid = bos.subtotal
FROM public.bookings b
WHERE bos.booking_id = b.id
  AND b.paid_at IS NOT NULL
  AND bos.paid_at IS NULL
  AND bos.is_cancelled = false;
