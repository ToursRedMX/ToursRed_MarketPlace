-- Ampliar CHECK constraint de discount_type
ALTER TABLE public.discount_codes
  DROP CONSTRAINT IF EXISTS discount_codes_discount_type_check;

ALTER TABLE public.discount_codes
  ADD CONSTRAINT discount_codes_discount_type_check
  CHECK (discount_type IN (
    'tour_percentage',
    'tour_fixed',
    'agency_tour_percentage',
    'agency_tour_fixed',
    'membership_free_month',
    'membership_percentage',
    'membership_fixed',
    'gift_card_percentage',
    'gift_card_fixed',
    'service_fee_percentage',
    'service_fee_fixed',
    'service_fee_full',
    'insurance_percentage',
    'insurance_fixed',
    'insurance_free'
  ));

-- Ampliar CHECK constraint de applicable_to
ALTER TABLE public.discount_codes
  DROP CONSTRAINT IF EXISTS discount_codes_applicable_to_check;

ALTER TABLE public.discount_codes
  ADD CONSTRAINT discount_codes_applicable_to_check
  CHECK (applicable_to IN (
    'tours',
    'memberships',
    'gift_cards',
    'service_fees',
    'insurance'
  ));

-- Agregar columnas de descuento de seguro a bookings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'insurance_discount_code_id'
  ) THEN
    ALTER TABLE public.bookings
      ADD COLUMN insurance_discount_code_id uuid REFERENCES public.discount_codes(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'insurance_discount_amount'
  ) THEN
    ALTER TABLE public.bookings
      ADD COLUMN insurance_discount_amount numeric(10,2) DEFAULT 0;
  END IF;
END $$;

-- Funcion para validar codigos de descuento de seguro
CREATE OR REPLACE FUNCTION validate_insurance_discount_code(
  p_code text,
  p_user_id uuid
)
RETURNS jsonb
SECURITY INVOKER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_code_record RECORD;
BEGIN
  SELECT * INTO v_code_record
  FROM public.discount_codes
  WHERE UPPER(code) = UPPER(p_code);

  IF v_code_record IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Codigo de descuento no encontrado');
  END IF;

  IF NOT v_code_record.is_active THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este codigo de descuento no esta activo');
  END IF;

  IF now() < v_code_record.valid_from THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este codigo de descuento aun no es valido');
  END IF;

  IF now() > v_code_record.valid_until THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este codigo de descuento ha expirado');
  END IF;

  IF v_code_record.applicable_to != 'insurance' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este codigo no aplica al seguro de viajero');
  END IF;

  IF v_code_record.max_uses IS NOT NULL AND v_code_record.times_used >= v_code_record.max_uses THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Este codigo ha alcanzado su limite maximo de usos');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.discount_code_usage
    WHERE discount_code_id = v_code_record.id
    AND user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Ya has utilizado este codigo de descuento anteriormente');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'code_id', v_code_record.id,
    'code', v_code_record.code,
    'description', v_code_record.description,
    'discount_type', v_code_record.discount_type,
    'discount_value', v_code_record.discount_value,
    'max_discount_amount', v_code_record.max_discount_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_insurance_discount_code TO authenticated;
