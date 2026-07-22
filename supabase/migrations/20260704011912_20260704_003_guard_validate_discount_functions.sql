
-- Migration 3: Add auth.uid() ownership guard to validate_discount_code
-- and validate_featured_slot_discount.
-- These functions are called by authenticated users; p_user_id must match the caller.

CREATE OR REPLACE FUNCTION public.validate_discount_code(
  p_code text,
  p_user_id uuid,
  p_applicable_to text DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
DECLARE
  v_code_record record;
  v_has_used boolean;
BEGIN
  -- Authenticated callers may only validate codes for themselves
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Acceso no autorizado');
  END IF;

  SELECT * INTO v_code_record
  FROM public.discount_codes
  WHERE UPPER(code) = UPPER(p_code);

  IF v_code_record IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Código de descuento no encontrado');
  END IF;

  IF NOT v_code_record.is_active THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este código de descuento no está activo');
  END IF;

  IF now() < v_code_record.valid_from THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este código de descuento aún no es válido');
  END IF;

  IF now() > v_code_record.valid_until THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este código de descuento ha expirado');
  END IF;

  IF p_applicable_to IS NOT NULL AND v_code_record.applicable_to != p_applicable_to THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este código no es aplicable para este tipo de compra');
  END IF;

  SELECT check_user_code_usage(p_code, p_user_id) INTO v_has_used;

  IF v_has_used THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Ya has utilizado este código de descuento anteriormente');
  END IF;

  IF v_code_record.max_uses IS NOT NULL AND v_code_record.times_used >= v_code_record.max_uses THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este código ha alcanzado su límite máximo de usos');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code_id', v_code_record.id,
    'code', v_code_record.code,
    'description', v_code_record.description,
    'discount_type', v_code_record.discount_type,
    'discount_value', v_code_record.discount_value,
    'applicable_to', v_code_record.applicable_to,
    'membership_plan_type', COALESCE(v_code_record.membership_plan_type, 'both')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_featured_slot_discount(p_code text, p_user_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- Authenticated callers may only validate codes for themselves
  IF auth.uid() IS NOT NULL AND auth.uid() != p_user_id THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Acceso no autorizado');
  END IF;

  RETURN validate_discount_code(p_code, p_user_id, 'featured_slots');
END;
$$;
