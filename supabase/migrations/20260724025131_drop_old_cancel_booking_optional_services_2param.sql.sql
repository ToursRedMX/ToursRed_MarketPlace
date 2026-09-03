-- Drop the old 2-parameter overload that has the bug (refunds subtotal + service_charge together without separating).
-- The new 3-parameter version (with p_refund_service_charge) is the correct one and is already used by all 5 call sites.
DROP FUNCTION IF EXISTS public.cancel_booking_optional_services(uuid, boolean);