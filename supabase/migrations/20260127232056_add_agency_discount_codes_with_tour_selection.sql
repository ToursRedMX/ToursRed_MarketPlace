
-- Step 1: Add new columns to discount_codes table
ALTER TABLE public.discount_codes 
  ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES public.agencies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tour_id uuid REFERENCES public.tours(id) ON DELETE CASCADE;

-- Step 2: Update discount_type enum constraint to include agency types
ALTER TABLE public.discount_codes 
  DROP CONSTRAINT IF EXISTS discount_codes_discount_type_check;

ALTER TABLE public.discount_codes 
  ADD CONSTRAINT discount_codes_discount_type_check 
  CHECK (discount_type IN (
    'tour_percentage', 
    'tour_fixed', 
    'membership_free_month', 
    'gift_card_percentage', 
    'gift_card_fixed',
    'agency_tour_percentage',
    'agency_tour_fixed'
  ));

-- Step 3: Add constraint that agency codes must be for tours only
ALTER TABLE public.discount_codes 
  ADD CONSTRAINT agency_codes_for_tours_only 
  CHECK (
    agency_id IS NULL 
    OR (agency_id IS NOT NULL AND applicable_to = 'tours')
  );

-- Step 4: Add constraint that agency_id must be present when using agency discount types
ALTER TABLE public.discount_codes 
  ADD CONSTRAINT agency_types_require_agency_id 
  CHECK (
    (discount_type IN ('agency_tour_percentage', 'agency_tour_fixed') AND agency_id IS NOT NULL)
    OR (discount_type NOT IN ('agency_tour_percentage', 'agency_tour_fixed'))
  );

-- Step 5: Add constraint that tour_id can only exist if agency_id exists
ALTER TABLE public.discount_codes 
  ADD CONSTRAINT tour_id_requires_agency_id 
  CHECK (
    tour_id IS NULL 
    OR (tour_id IS NOT NULL AND agency_id IS NOT NULL)
  );

-- Step 6: Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_discount_codes_agency_id 
  ON public.discount_codes(agency_id) 
  WHERE agency_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_discount_codes_tour_id 
  ON public.discount_codes(tour_id) 
  WHERE tour_id IS NOT NULL;

-- Step 7: Create function to validate that tour belongs to agency
CREATE OR REPLACE FUNCTION validate_tour_belongs_to_agency()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- If tour_id is specified, validate it belongs to the agency
  IF NEW.tour_id IS NOT NULL AND NEW.agency_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tours
      WHERE tours.id = NEW.tour_id
      AND tours.agency_id = NEW.agency_id
    ) THEN
      RAISE EXCEPTION 'Tour does not belong to the specified agency';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to validate tour belongs to agency
DROP TRIGGER IF EXISTS validate_tour_agency_trigger ON public.discount_codes;
CREATE TRIGGER validate_tour_agency_trigger
  BEFORE INSERT OR UPDATE ON public.discount_codes
  FOR EACH ROW
  EXECUTE FUNCTION validate_tour_belongs_to_agency();

-- Step 8: Create function to get active tours for an agency
CREATE OR REPLACE FUNCTION get_agency_tours(p_agency_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  destination text,
  price numeric,
  start_date date,
  end_date date,
  image_url text
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id,
    t.name,
    t.destination,
    t.price,
    t.start_date,
    t.end_date,
    t.image_url
  FROM public.tours t
  WHERE t.agency_id = p_agency_id
  AND t.end_date >= CURRENT_DATE
  ORDER BY t.start_date ASC;
END;
$$;

-- Step 9: Create function to validate agency discount code
CREATE OR REPLACE FUNCTION validate_agency_discount_code(
  p_code text,
  p_tour_id uuid,
  p_user_id uuid
)
RETURNS TABLE (
  is_valid boolean,
  discount_code_id uuid,
  discount_type text,
  discount_value numeric,
  error_message text
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_code_record RECORD;
  v_tour_agency_id uuid;
BEGIN
  -- Get the tour's agency
  SELECT agency_id INTO v_tour_agency_id
  FROM public.tours
  WHERE id = p_tour_id;

  -- Find the discount code
  SELECT * INTO v_code_record
  FROM public.discount_codes
  WHERE UPPER(code) = UPPER(p_code)
  LIMIT 1;

  -- Check if code exists
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::numeric, 'Código de descuento no encontrado';
    RETURN;
  END IF;

  -- Check if code is active
  IF v_code_record.is_active = false THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::numeric, 'Código de descuento inactivo';
    RETURN;
  END IF;

  -- Check if code is within valid dates
  IF now() < v_code_record.valid_from OR now() > v_code_record.valid_until THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::numeric, 'Código de descuento fuera del período válido';
    RETURN;
  END IF;

  -- Check if code has reached max uses
  IF v_code_record.max_uses IS NOT NULL AND v_code_record.times_used >= v_code_record.max_uses THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::numeric, 'Código de descuento ha alcanzado el máximo de usos';
    RETURN;
  END IF;

  -- Check if user has already used this code
  IF EXISTS (
    SELECT 1 FROM public.discount_code_usage
    WHERE discount_code_id = v_code_record.id
    AND user_id = p_user_id
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::numeric, 'Ya has usado este código de descuento';
    RETURN;
  END IF;

  -- If it's an agency code, validate agency and tour
  IF v_code_record.agency_id IS NOT NULL THEN
    -- Check if tour belongs to the code's agency
    IF v_tour_agency_id != v_code_record.agency_id THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::numeric, 'Este código no es válido para este tour';
      RETURN;
    END IF;

    -- If code is for a specific tour, check it matches
    IF v_code_record.tour_id IS NOT NULL AND v_code_record.tour_id != p_tour_id THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::numeric, 'Este código solo es válido para un tour específico';
      RETURN;
    END IF;
  END IF;

  -- Code is valid
  RETURN QUERY SELECT 
    true, 
    v_code_record.id, 
    v_code_record.discount_type, 
    v_code_record.discount_value, 
    NULL::text;
END;
$$;

-- Step 10: Add RLS policies for agencies

-- Agencies can view their own discount codes
CREATE POLICY "Agencies can view own discount codes"
  ON public.discount_codes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE agencies.user_id = auth.uid()
      AND agencies.id = discount_codes.agency_id
    )
  );

-- Agencies can insert their own discount codes
CREATE POLICY "Agencies can insert own discount codes"
  ON public.discount_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE agencies.user_id = auth.uid()
      AND agencies.id = discount_codes.agency_id
    )
  );

-- Agencies can update their own discount codes
CREATE POLICY "Agencies can update own discount codes"
  ON public.discount_codes
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE agencies.user_id = auth.uid()
      AND agencies.id = discount_codes.agency_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE agencies.user_id = auth.uid()
      AND agencies.id = discount_codes.agency_id
    )
  );

-- Agencies can delete their own discount codes
CREATE POLICY "Agencies can delete own discount codes"
  ON public.discount_codes
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agencies
      WHERE agencies.user_id = auth.uid()
      AND agencies.id = discount_codes.agency_id
    )
  );
