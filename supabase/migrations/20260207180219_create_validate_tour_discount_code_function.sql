
CREATE OR REPLACE FUNCTION validate_tour_discount_code(
  p_code text,
  p_user_id uuid,
  p_tour_id uuid
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_code_record RECORD;
  v_tour_agency_id uuid;
BEGIN
  SELECT agency_id INTO v_tour_agency_id
  FROM public.tours
  WHERE id = p_tour_id;

  IF v_tour_agency_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Tour no encontrado');
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

  IF v_code_record.applicable_to != 'tours' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este código no es aplicable a tours');
  END IF;

  IF v_code_record.max_uses IS NOT NULL AND v_code_record.times_used >= v_code_record.max_uses THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este código ha alcanzado su límite máximo de usos');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.discount_code_usage
    WHERE discount_code_id = v_code_record.id
    AND user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Ya has utilizado este código de descuento anteriormente');
  END IF;

  IF v_code_record.agency_id IS NOT NULL THEN
    IF v_tour_agency_id != v_code_record.agency_id THEN
      RETURN jsonb_build_object('valid', false, 'error', 'Este código no es válido para este tour');
    END IF;
  END IF;

  IF v_code_record.tour_id IS NOT NULL AND v_code_record.tour_id != p_tour_id THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este código solo es válido para un tour específico');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code_id', v_code_record.id,
    'code', v_code_record.code,
    'description', v_code_record.description,
    'discount_type', v_code_record.discount_type,
    'discount_value', v_code_record.discount_value,
    'discount_applies_to', v_code_record.discount_applies_to,
    'max_discount_amount', v_code_record.max_discount_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_tour_discount_code TO authenticated;
