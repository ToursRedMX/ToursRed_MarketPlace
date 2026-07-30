/*
# Update get_remaining_service_fee_exemption to return JSON with monthly_limit

## Purpose
The frontend currently hardcodes the monthly exemption limit ($500) in display text.
The backend already reads this limit from platform_settings.membership_service_fee_exemption_monthly_limit,
but the RPC function only returns the remaining amount, not the configured limit.
This migration changes the return type to JSON so the frontend can display the actual configured limit.

## Changes
1. DROP existing function `get_remaining_service_fee_exemption(uuid)` (required because return type changes)
2. Recreate function with return type `jsonb`
   - Returns `{"remaining": <number>, "monthly_limit": <number>}` instead of a scalar
   - All logic for calculating the remaining amount is preserved exactly
   - The monthly_limit is read from platform_settings (same source as apply_membership_service_fee_exemption)

## Security
- Function remains SECURITY DEFINER with fixed search_path
- Execute grant remains on authenticated role only
- No new tables or columns created
- No RLS policy changes
*/

DROP FUNCTION IF EXISTS public.get_remaining_service_fee_exemption(uuid);

CREATE OR REPLACE FUNCTION public.get_remaining_service_fee_exemption(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_exemption_used decimal;
  v_reset_date timestamptz;
  v_monthly_limit numeric;
  v_remaining numeric;
BEGIN
  SELECT COALESCE(membership_service_fee_exemption_monthly_limit, 500)
  INTO v_monthly_limit
  FROM public.platform_settings
  LIMIT 1;

  IF v_monthly_limit IS NULL THEN
    v_monthly_limit := 500;
  END IF;

  SELECT
    service_fee_exemption_used,
    service_fee_exemption_reset_date
  INTO
    v_exemption_used,
    v_reset_date
  FROM public.memberships
  WHERE user_id = p_user_id
    AND status <> 'expired'
    AND current_period_end > now()
  ORDER BY current_period_end DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('remaining', 0, 'monthly_limit', v_monthly_limit);
  END IF;

  IF now() >= v_reset_date THEN
    v_remaining := v_monthly_limit;
  ELSE
    v_remaining := GREATEST(0, v_monthly_limit - v_exemption_used);
  END IF;

  RETURN jsonb_build_object('remaining', v_remaining, 'monthly_limit', v_monthly_limit);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_remaining_service_fee_exemption(uuid) TO authenticated;