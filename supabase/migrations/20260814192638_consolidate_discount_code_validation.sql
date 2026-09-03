/*
# Consolidate discount code validation into atomic apply functions

## Purpose
Three separate discount validation implementations existed with different atomicity:
- validate_discount_code + apply_discount_code (best pattern: validate + INSERT usage atomically)
- validate_tour_discount_code (standalone validation, no usage INSERT, race-condition exposed)
- validate_insurance_discount_code (duplicates apply_discount_code logic, hardcoded for insurance)

This migration:
1. Creates apply_tour_discount_code following the best pattern (validate + INSERT atomically)
2. Creates apply_insurance_discount_code following the same pattern
3. Revokes EXECUTE on validate_tour_discount_code and validate_insurance_discount_code
   from authenticated/anon so they can't be called directly from the client
*/

-- 1. Create apply_tour_discount_code (atomic validate + register usage)
CREATE OR REPLACE FUNCTION public.apply_tour_discount_code(
  p_code text,
  p_user_id uuid,
  p_tour_id uuid,
  p_booking_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_validation jsonb;
  v_code_id uuid;
  v_usage_id uuid;
  v_code record;
BEGIN
  -- Lock the discount code row to prevent race conditions
  SELECT * INTO v_code
  FROM discount_codes
  WHERE code = UPPER(p_code)
    AND is_active = true
  FOR UPDATE;

  IF v_code IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Codigo de descuento no valido o expirado');
  END IF;

  -- Validate using the existing validate_tour_discount_code logic
  v_validation := validate_tour_discount_code(p_code, p_user_id, p_tour_id);

  IF NOT (v_validation->>'valid')::boolean THEN
    RETURN v_validation;
  END IF;

  v_code_id := (v_validation->>'code_id')::uuid;

  -- Atomically register the usage
  INSERT INTO discount_code_usage (discount_code_id, user_id, booking_id)
  VALUES (v_code_id, p_user_id, p_booking_id)
  RETURNING id INTO v_usage_id;

  RETURN jsonb_build_object(
    'success', true,
    'usage_id', v_usage_id,
    'discount_type', v_validation->>'discount_type',
    'discount_value', v_validation->>'discount_value',
    'applicable_to', v_validation->>'applicable_to',
    'code_id', v_code_id
  );
END;
$function$;

-- 2. Create apply_insurance_discount_code (atomic validate + register usage)
CREATE OR REPLACE FUNCTION public.apply_insurance_discount_code(
  p_code text,
  p_user_id uuid,
  p_booking_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_validation jsonb;
  v_code_id uuid;
  v_usage_id uuid;
  v_code record;
BEGIN
  -- Lock the discount code row to prevent race conditions
  SELECT * INTO v_code
  FROM discount_codes
  WHERE code = UPPER(p_code)
    AND is_active = true
  FOR UPDATE;

  IF v_code IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Codigo de descuento no valido o expirado');
  END IF;

  -- Validate using the existing validate_insurance_discount_code logic
  v_validation := validate_insurance_discount_code(p_code, p_user_id);

  IF NOT (v_validation->>'valid')::boolean THEN
    RETURN v_validation;
  END IF;

  v_code_id := (v_validation->>'code_id')::uuid;

  -- Atomically register the usage
  INSERT INTO discount_code_usage (discount_code_id, user_id, booking_id)
  VALUES (v_code_id, p_user_id, p_booking_id)
  RETURNING id INTO v_usage_id;

  RETURN jsonb_build_object(
    'success', true,
    'usage_id', v_usage_id,
    'discount_type', v_validation->>'discount_type',
    'discount_value', v_validation->>'discount_value',
    'applicable_to', v_validation->>'applicable_to',
    'code_id', v_code_id
  );
END;
$function$;

-- Grant execute on the new atomic functions to authenticated
GRANT EXECUTE ON FUNCTION public.apply_tour_discount_code(text, uuid, uuid, uuid) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.apply_insurance_discount_code(text, uuid, uuid) TO authenticated, service_role, postgres;

-- 3. Revoke EXECUTE on the non-atomic standalone validation functions
--    These should only be called internally by the apply_* functions, not from the client
REVOKE EXECUTE ON FUNCTION public.validate_tour_discount_code(text, uuid, uuid) FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.validate_insurance_discount_code(text, uuid) FROM authenticated, anon;

-- Keep EXECUTE on validate_discount_code since it's used by the booking flow for
-- non-tour-specific validation (gift cards, memberships, etc.) and is already
-- guarded by the 20260704_003 migration