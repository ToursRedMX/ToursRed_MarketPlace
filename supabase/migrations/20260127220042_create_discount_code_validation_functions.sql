
-- Function to check if user has already used a discount code
CREATE OR REPLACE FUNCTION check_user_code_usage(
  p_code text,
  p_user_id uuid
)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_code_id uuid;
  v_has_used boolean;
BEGIN
  -- Get code ID
  SELECT id INTO v_code_id
  FROM public.discount_codes
  WHERE UPPER(code) = UPPER(p_code);

  IF v_code_id IS NULL THEN
    RETURN false;
  END IF;

  -- Check if user has used this code
  SELECT EXISTS(
    SELECT 1
    FROM public.discount_code_usage
    WHERE discount_code_id = v_code_id
    AND user_id = p_user_id
  ) INTO v_has_used;

  RETURN v_has_used;
END;
$$;

-- Function to validate a discount code
CREATE OR REPLACE FUNCTION validate_discount_code(
  p_code text,
  p_user_id uuid,
  p_applicable_to text DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_code_record record;
  v_has_used boolean;
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

  -- Check if user has already used this code
  SELECT check_user_code_usage(p_code, p_user_id) INTO v_has_used;
  
  IF v_has_used THEN
    RETURN jsonb_build_object(
      'valid', false,
      'error', 'Ya has utilizado este código de descuento anteriormente'
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
    'applicable_to', v_code_record.applicable_to
  );
END;
$$;

-- Function to apply a discount code (record usage)
CREATE OR REPLACE FUNCTION apply_discount_code(
  p_code text,
  p_user_id uuid,
  p_booking_id uuid DEFAULT NULL,
  p_gift_card_id uuid DEFAULT NULL,
  p_membership_id uuid DEFAULT NULL
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_validation jsonb;
  v_code_id uuid;
  v_usage_id uuid;
BEGIN
  -- Validate the code first
  v_validation := validate_discount_code(p_code, p_user_id, NULL);

  IF NOT (v_validation->>'valid')::boolean THEN
    RETURN v_validation;
  END IF;

  -- Get code ID from validation result
  v_code_id := (v_validation->>'code_id')::uuid;

  -- Insert usage record
  INSERT INTO public.discount_code_usage (
    discount_code_id,
    user_id,
    booking_id,
    gift_card_id,
    membership_id
  )
  VALUES (
    v_code_id,
    p_user_id,
    p_booking_id,
    p_gift_card_id,
    p_membership_id
  )
  RETURNING id INTO v_usage_id;

  -- Return success with validation details
  RETURN jsonb_build_object(
    'success', true,
    'usage_id', v_usage_id,
    'discount_type', v_validation->>'discount_type',
    'discount_value', v_validation->>'discount_value',
    'applicable_to', v_validation->>'applicable_to'
  );
END;
$$;

-- Function to get discount code details with usage statistics
CREATE OR REPLACE FUNCTION get_discount_code_details(p_code_id uuid)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_code_record record;
  v_usage_records jsonb;
  v_result jsonb;
BEGIN
  -- Get code details
  SELECT *
  INTO v_code_record
  FROM public.discount_codes
  WHERE id = p_code_id;

  IF v_code_record IS NULL THEN
    RETURN jsonb_build_object('error', 'Código no encontrado');
  END IF;

  -- Get usage records with user details
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', dcu.id,
      'user_id', dcu.user_id,
      'user_name', u.first_name || ' ' || u.last_name,
      'used_at', dcu.used_at,
      'booking_id', dcu.booking_id,
      'gift_card_id', dcu.gift_card_id,
      'membership_id', dcu.membership_id
    )
    ORDER BY dcu.used_at DESC
  )
  INTO v_usage_records
  FROM public.discount_code_usage dcu
  LEFT JOIN public.users u ON u.id = dcu.user_id
  WHERE dcu.discount_code_id = p_code_id;

  -- Build result
  v_result := jsonb_build_object(
    'id', v_code_record.id,
    'code', v_code_record.code,
    'description', v_code_record.description,
    'discount_type', v_code_record.discount_type,
    'discount_value', v_code_record.discount_value,
    'applicable_to', v_code_record.applicable_to,
    'is_single_use', v_code_record.is_single_use,
    'is_active', v_code_record.is_active,
    'valid_from', v_code_record.valid_from,
    'valid_until', v_code_record.valid_until,
    'max_uses', v_code_record.max_uses,
    'times_used', v_code_record.times_used,
    'created_at', v_code_record.created_at,
    'usage_records', COALESCE(v_usage_records, '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION check_user_code_usage TO authenticated;
GRANT EXECUTE ON FUNCTION validate_discount_code TO authenticated;
GRANT EXECUTE ON FUNCTION apply_discount_code TO authenticated;
GRANT EXECUTE ON FUNCTION get_discount_code_details TO authenticated;
