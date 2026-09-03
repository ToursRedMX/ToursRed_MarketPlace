/*
# Fix cancel_booking_optional_services: separate service charge from subtotal

## Problem
The current RPC refunds `total_paid` (which mixes subtotal + service_charge)
whenever an optional is refundable. This means the service charge of optional
services gets refunded even on traveler cancellations, contradicting the
business rule: service charge follows the same logic as the tour's service
charge — traveler cancels = no refund; agency cancels = full refund;
admin decides via checkbox.

## Changes
1. Add new parameter `p_refund_service_charge boolean DEFAULT false`.
2. Select `service_charge` column from `booking_optional_services`.
3. Separate refund calculation:
   - `v_refund_subtotal`: based on `is_refundable` logic (unchanged).
   - `v_refund_service_charge`: refunded only when `p_cancelled_by_agency = true`
     OR `p_refund_service_charge = true`.
   - `v_refund = v_refund_subtotal + v_refund_service_charge`.
4. Grant EXECUTE to authenticated (preserve existing grants).

## Notes
- The subtotal (principal) of a refundable optional is still always refunded
  at 100% regardless of who cancels — this is correct per business rules.
- Only the service charge portion is conditional on who cancels.
- No data loss: no columns dropped, no data modified.
*/

CREATE OR REPLACE FUNCTION public.cancel_booking_optional_services(
  p_booking_id uuid,
  p_cancelled_by_agency boolean DEFAULT false,
  p_refund_service_charge boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user_id uuid;
  v_membership_id uuid;
  v_opt RECORD;
BEGIN
  -- Get the booking's user_id for exemption revert
  SELECT b.user_id INTO v_user_id
  FROM bookings b
  WHERE b.id = p_booking_id;

  -- Cancel each optional service individually
  FOR v_opt IN
    SELECT
      bos.id,
      bos.service_kind,
      bos.subtotal,
      bos.service_charge,
      bos.total_paid,
      bos.membership_exemption_used,
      bos.tour_optional_service_id,
      tos.is_refundable
    FROM booking_optional_services bos
    LEFT JOIN tour_optional_services tos ON bos.tour_optional_service_id = tos.id
    WHERE bos.booking_id = p_booking_id
      AND bos.is_cancelled = false
  LOOP
    -- Determine refundability:
    -- - Admin/agency cancellation: everything refundable
    -- - Traveler cancellation: pickup/language always refundable;
    --   traditional optionals respect is_refundable flag
    DECLARE
      v_refund numeric;
      v_refund_subtotal numeric;
      v_refund_service_charge numeric;
      v_is_refundable boolean;
      v_service_charge_should_refund boolean;
    BEGIN
      IF p_cancelled_by_agency = true THEN
        v_is_refundable := true;
      ELSIF v_opt.service_kind IN ('pickup', 'language') THEN
        v_is_refundable := true;
      ELSIF v_opt.tour_optional_service_id IS NULL THEN
        -- No FK to tour_optional_services — treat as refundable
        v_is_refundable := true;
      ELSE
        v_is_refundable := COALESCE(v_opt.is_refundable, true);
      END IF;

      -- Subtotal (principal) refund: based on is_refundable
      v_refund_subtotal := CASE WHEN v_is_refundable THEN COALESCE(v_opt.subtotal, 0) ELSE 0 END;

      -- Service charge refund: only when agency cancels OR admin explicitly opts in
      v_service_charge_should_refund := (p_cancelled_by_agency = true OR p_refund_service_charge = true);
      v_refund_service_charge := CASE WHEN v_service_charge_should_refund THEN COALESCE(v_opt.service_charge, 0) ELSE 0 END;

      v_refund := v_refund_subtotal + v_refund_service_charge;

      -- Revert membership exemption if any was used
      IF v_opt.membership_exemption_used > 0 AND v_user_id IS NOT NULL THEN
        SELECT m.id INTO v_membership_id
        FROM memberships m
        WHERE m.user_id = v_user_id
          AND m.status <> 'expired'
          AND m.current_period_end > now()
        ORDER BY m.current_period_end DESC
        LIMIT 1;

        IF v_membership_id IS NOT NULL THEN
          UPDATE memberships
          SET service_fee_exemption_used = GREATEST(0, service_fee_exemption_used - v_opt.membership_exemption_used)
          WHERE id = v_membership_id;
        END IF;
      END IF;

      -- Mark the optional as cancelled
      UPDATE booking_optional_services
      SET
        is_cancelled = true,
        cancelled_at = now(),
        cancelled_by_agency = p_cancelled_by_agency,
        refund_amount = v_refund,
        updated_at = now()
      WHERE id = v_opt.id;
    END;
  END LOOP;
END;
$function$;

-- Preserve execute grant for authenticated users
GRANT EXECUTE ON FUNCTION public.cancel_booking_optional_services(uuid, boolean, boolean) TO authenticated;
