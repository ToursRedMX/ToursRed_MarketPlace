/*
# Fix cancel_booking_optional_services for two-bucket model

## Changes
1. Use LEFT JOIN instead of INNER JOIN so pickup/language entries
   (NULL tour_optional_service_id) are included in the cancellation.
2. Use total_paid instead of subtotal for refund_amount — total_paid is
   the actual amount the traveler paid (subtotal + service_charge - exemption).
3. Revert membership exemption: decrement service_fee_exemption_used on the
   membership row by the membership_exemption_used stored on each optional.
4. For admin cancellations (p_cancelled_by_agency = false), all optionals
   are refundable including pickup/language. For agency cancellations,
   all are refundable too. For traveler cancellations, traditional
   optionals respect is_refundable; pickup/language are always refundable.
*/

CREATE OR REPLACE FUNCTION public.cancel_booking_optional_services(
  p_booking_id uuid,
  p_cancelled_by_agency boolean DEFAULT false
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
      v_is_refundable boolean;
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

      v_refund := CASE WHEN v_is_refundable THEN COALESCE(v_opt.total_paid, v_opt.subtotal, 0) ELSE 0 END;

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
