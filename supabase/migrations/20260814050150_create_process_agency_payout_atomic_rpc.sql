-- Atomic payout processing: inserts agency_payout + updates commission_records + penalty_records in one transaction
CREATE OR REPLACE FUNCTION process_agency_payout_atomic(
  p_agency_id uuid,
  p_commission_ids uuid[],
  p_penalty_ids uuid[],
  p_total_amount numeric,
  p_net_amount numeric,
  p_platform_commission_amount numeric DEFAULT 0,
  p_payment_method text DEFAULT 'bank_transfer',
  p_notes text DEFAULT NULL,
  p_receipt_url text DEFAULT NULL,
  p_receipt_filename text DEFAULT NULL,
  p_bill_number text DEFAULT NULL,
  p_bank_reference text DEFAULT NULL,
  p_processed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout_id uuid;
  v_payout_code text;
  v_commission_count int;
  v_penalty_count int;
BEGIN
  v_payout_code := 'PAY-' || EXTRACT(EPOCH FROM now())::bigint;
  v_commission_count := array_length(p_commission_ids, 1);
  v_penalty_count := COALESCE(array_length(p_penalty_ids, 1), 0);

  -- Insert the payout record
  INSERT INTO agency_payouts (
    agency_id,
    amount,
    net_amount,
    platform_commission_amount,
    payment_method,
    notes,
    receipt_url,
    payout_code,
    bill_number,
    status,
    commission_records_count,
    payout_date
  )
  VALUES (
    p_agency_id,
    p_total_amount,
    p_net_amount,
    p_platform_commission_amount,
    p_payment_method,
    p_notes,
    p_receipt_url,
    v_payout_code,
    p_bill_number,
    'completed',
    COALESCE(v_commission_count, 0) + v_penalty_count,
    CURRENT_DATE
  )
  RETURNING id INTO v_payout_id;

  -- Update commission records atomically
  IF v_commission_count > 0 THEN
    UPDATE commission_records
    SET
      status = 'processed',
      payout_id = v_payout_id,
      processed_at = now(),
      payment_method = p_payment_method,
      payment_notes = p_notes,
      payment_receipt_url = p_receipt_url,
      payment_receipt_filename = p_receipt_filename,
      notified_at = now()
    WHERE id = ANY(p_commission_ids)
      AND agency_id = p_agency_id;
  END IF;

  -- Update penalty records atomically
  IF v_penalty_count > 0 THEN
    UPDATE cancellation_penalty_records
    SET
      status = 'processed',
      processed_at = now(),
      payment_method = p_payment_method,
      payment_notes = p_notes,
      payment_receipt_url = p_receipt_url,
      payment_receipt_filename = p_receipt_filename
    WHERE id = ANY(p_penalty_ids);
  END IF;

  RETURN jsonb_build_object(
    'payout_id', v_payout_id,
    'commission_count', COALESCE(v_commission_count, 0),
    'penalty_count', v_penalty_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION process_agency_payout_atomic TO authenticated;
