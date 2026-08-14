-- RPC to atomically claim a CFDI stamping slot using advisory lock + check + insert
-- Prevents duplicate CFDI generation for the same booking/checkin charge
CREATE OR REPLACE FUNCTION public.claim_cfdi_stamping_slot(
  p_booking_id uuid,
  p_invoice_type text,
  p_checkin_charge_id uuid DEFAULT NULL,
  p_agency_id uuid DEFAULT NULL,
  p_pac_provider text DEFAULT 'facturapi',
  p_serie text DEFAULT 'A',
  p_receptor_rfc text DEFAULT 'XAXX010101000',
  p_receptor_razon_social text DEFAULT NULL,
  p_receptor_regimen_fiscal text DEFAULT '616',
  p_receptor_uso_cfdi text DEFAULT 'S01',
  p_receptor_codigo_postal text DEFAULT NULL,
  p_subtotal numeric DEFAULT 0,
  p_iva_amount numeric DEFAULT 0,
  p_total numeric DEFAULT 0,
  p_discount_amount numeric DEFAULT NULL,
  p_tour_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_existing_id uuid;
  v_new_id uuid;
BEGIN
  -- Advisory lock serializes concurrent calls for the same booking
  PERFORM pg_advisory_xact_lock(hashtext(p_booking_id::text));

  -- Check if a stamped or pending CFDI already exists
  IF p_checkin_charge_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM cfdi_invoices
    WHERE checkin_charge_id = p_checkin_charge_id
      AND status IN ('stamped', 'pending')
    LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id
    FROM cfdi_invoices
    WHERE booking_id = p_booking_id
      AND invoice_type = p_invoice_type
      AND status IN ('stamped', 'pending')
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_exists', 'cfdi_id', v_existing_id);
  END IF;

  -- Insert the pending record atomically within the same transaction
  INSERT INTO cfdi_invoices (
    invoice_type, booking_id, checkin_charge_id, agency_id,
    pac_provider, serie, receptor_rfc, receptor_razon_social,
    receptor_regimen_fiscal, receptor_uso_cfdi, receptor_codigo_postal,
    subtotal, iva_amount, total, discount_amount, tour_amount, status
  ) VALUES (
    p_invoice_type, p_booking_id, p_checkin_charge_id, p_agency_id,
    p_pac_provider, p_serie, p_receptor_rfc, p_receptor_razon_social,
    p_receptor_regimen_fiscal, p_receptor_uso_cfdi, p_receptor_codigo_postal,
    p_subtotal, p_iva_amount, p_total, p_discount_amount, p_tour_amount, 'pending'
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('success', true, 'cfdi_id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_cfdi_stamping_slot TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cfdi_stamping_slot TO service_role;