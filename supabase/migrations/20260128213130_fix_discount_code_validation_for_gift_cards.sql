
-- Overloaded function to validate discount code without user_id (for anonymous purchases)
CREATE OR REPLACE FUNCTION validate_discount_code(
  p_code text,
  p_applicable_to text DEFAULT NULL,
  p_purchase_amount numeric DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_code_record record;
  v_result jsonb;
BEGIN
  -- Find the discount code (case insensitive)
  SELECT *
  INTO v_code_record
  FROM public.discount_codes
  WHERE UPPER(code) = UPPER(p_code);

  -- Check if code exists
  IF v_code_record IS NULL THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Código de descuento no encontrado'
    );
  END IF;

  -- Check if code is active
  IF NOT v_code_record.is_active THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Este código de descuento no está activo'
    );
  END IF;

  -- Check validity period
  IF now() < v_code_record.valid_from THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Este código de descuento aún no es válido'
    );
  END IF;

  IF now() > v_code_record.valid_until THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Este código de descuento ha expirado'
    );
  END IF;

  -- Check if applicable_to matches (if specified)
  IF p_applicable_to IS NOT NULL AND v_code_record.applicable_to != p_applicable_to THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Este código no es aplicable para este tipo de compra'
    );
  END IF;

  -- Check max uses limit
  IF v_code_record.max_uses IS NOT NULL AND v_code_record.times_used >= v_code_record.max_uses THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Este código ha alcanzado su límite máximo de usos'
    );
  END IF;

  -- Code is valid, return details
  RETURN jsonb_build_object(
    'valid', true,
    'code_id', v_code_record.id,
    'code', v_code_record.code,
    'description', v_code_record.description,
    'discount_type', v_code_record.discount_type,
    'discount_value', v_code_record.discount_value,
    'applicable_to', v_code_record.applicable_to,
    'max_discount_amount', v_code_record.max_discount_amount
  );
END;
$$;

-- Grant execute permissions to both authenticated and anon users (for gift card purchases)
GRANT EXECUTE ON FUNCTION validate_discount_code(text, text, numeric) TO authenticated, anon;
