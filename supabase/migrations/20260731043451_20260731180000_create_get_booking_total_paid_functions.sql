/*
# Create get_booking_total_paid and get_booking_total_paid_batch functions

## Purpose
After changing `bookings.user_payment` to represent "saldo pendiente" (remaining
balance to pay) instead of "monto pagado" (amount paid), the UI needs a single
source of truth to compute the **real total paid** for a booking.

These two SQL functions replace direct reads of `bookings.user_payment` on
screens that display "Total Pagado".

## Functions

1. `get_booking_total_paid(p_booking_id uuid) RETURNS numeric`
   - Single-booking variant for detail pages (BookingSuccessPage, SuccessPage).
   - Returns the sum of:
     a) All `payment_transactions` rows for this booking with
        `status = 'succeeded'` AND `charge_context = 'booking_deposit'`.
     b) `bookings.toursred_cash_used` (wallet cash applied to the booking).
     c) `bookings.points_used / 100` (points converted to pesos at 1 peso = 1 punto).
   - Returns 0 if the booking does not exist or has no payments.

2. `get_booking_total_paid_batch(p_booking_ids uuid[]) RETURNS TABLE(booking_id uuid, total_paid numeric)`
   - Batch variant for list pages (TravelerBookings, AdminBookings).
   - Accepts an array of booking UUIDs and returns one row per booking.
   - Same calculation logic as the single variant.

## Why charge_context = 'booking_deposit'?
The `payment_transactions` table also records payments for supplements, extras,
insurance, and payment-plan installments. Filtering on `charge_context =
'booking_deposit'` ensures we only count the deposit / full-payment transactions
that correspond to the core tour price — not post-booking extras that have their
own success pages and display their own totals.

## Security
- Both functions are `STABLE` and `SECURITY DEFINER` is NOT used — they run as
  the caller, so RLS on `payment_transactions` and `bookings` is respected.
- `GRANT EXECUTE` to `authenticated` so logged-in travelers and admins can call them.
- No new tables, no RLS policy changes.

## Idempotency
Both functions use `DROP FUNCTION IF EXISTS` before `CREATE`, so the migration
is safe to re-run.
*/

-- ---------------------------------------------------------------------------
-- Single-booking variant
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_booking_total_paid(uuid);

CREATE OR REPLACE FUNCTION public.get_booking_total_paid(p_booking_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(
      (SELECT COALESCE(SUM(amount), 0)
       FROM public.payment_transactions
       WHERE booking_id = p_booking_id
         AND status = 'succeeded'
         AND charge_context = 'booking_deposit'),
      0
    )
    + COALESCE(
      (SELECT toursred_cash_used FROM public.bookings WHERE id = p_booking_id),
      0
    )
    + COALESCE(
      (SELECT COALESCE(points_used, 0) / 100.0 FROM public.bookings WHERE id = p_booking_id),
      0
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_booking_total_paid(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Batch variant (for list pages)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_booking_total_paid_batch(uuid[]);

CREATE OR REPLACE FUNCTION public.get_booking_total_paid_batch(p_booking_ids uuid[])
RETURNS TABLE(booking_id uuid, total_paid numeric)
LANGUAGE sql
STABLE
AS $$
  SELECT
    b.id AS booking_id,
    COALESCE(
      (SELECT COALESCE(SUM(pt.amount), 0)
       FROM public.payment_transactions pt
       WHERE pt.booking_id = b.id
         AND pt.status = 'succeeded'
         AND pt.charge_context = 'booking_deposit'),
      0
    )
    + COALESCE(b.toursred_cash_used, 0)
    + COALESCE(b.points_used, 0) / 100.0
    AS total_paid
  FROM public.bookings b
  WHERE b.id = ANY(p_booking_ids);
$$;

GRANT EXECUTE ON FUNCTION public.get_booking_total_paid_batch(uuid[]) TO authenticated;
