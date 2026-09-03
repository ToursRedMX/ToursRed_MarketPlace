-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831042107
--   name:    fix_process_agency_payout_atomic_recalculate_server_side
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

-- BUG: p_total_amount / p_net_amount / p_platform_commission_amount se
-- tomaban directo del body de la peticion HTTP (ultimately del navegador del
-- admin) sin ninguna verificacion contra la suma real de los
-- commission_records/cancellation_penalty_records referenciados. El Edge
-- Function que la llama SI exige admin+MFA, pero eso protege QUIEN puede
-- llamar, no QUE MONTO se registra -- una sesion de admin comprometida, un
-- bug de calculo en el frontend, o una peticion manipulada podian registrar
-- un pago por cualquier monto, desconectado de lo que realmente se le debe
-- a la agencia. Esto tambien significa que el fix critico de hoy a
-- commission_records.agency_net_amount (el bug de sobrepago) no se
-- garantizaba en la practica si el frontend aun no habia refrescado su
-- calculo local. Se corrige recalculando SIEMPRE los montos en servidor a
-- partir de los IDs referenciados, ignorando cualquier monto que mande el
-- cliente.
CREATE OR REPLACE FUNCTION public.process_agency_payout_atomic(p_agency_id uuid, p_commission_ids uuid[], p_penalty_ids uuid[], p_total_amount numeric, p_net_amount numeric, p_platform_commission_amount numeric DEFAULT 0, p_payment_method text DEFAULT 'bank_transfer'::text, p_notes text DEFAULT NULL::text, p_receipt_url text DEFAULT NULL::text, p_receipt_filename text DEFAULT NULL::text, p_bill_number text DEFAULT NULL::text, p_bank_reference text DEFAULT NULL::text, p_processed_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payout_id uuid;
  v_payout_code text;
  v_commission_count int;
  v_penalty_count int;
  v_real_net_amount numeric;
  v_real_platform_commission numeric;
BEGIN
  v_commission_count := COALESCE(array_length(p_commission_ids, 1), 0);
  v_penalty_count := COALESCE(array_length(p_penalty_ids, 1), 0);

  -- Recalcular el monto real en servidor -- nunca confiar en lo que manda el
  -- cliente. Solo se cuentan registros que realmente pertenecen a esta
  -- agencia y siguen 'pending' (evita pagar dos veces el mismo registro).
  SELECT COALESCE(SUM(cr.agency_net_amount), 0), COALESCE(SUM(cr.agency_commission_amount), 0)
  INTO v_real_net_amount, v_real_platform_commission
  FROM commission_records cr
  WHERE cr.id = ANY(p_commission_ids)
    AND cr.agency_id = p_agency_id
    AND cr.status = 'pending';

  IF v_penalty_count > 0 THEN
    v_real_net_amount := v_real_net_amount + COALESCE((
      SELECT SUM(pr.agency_net_amount) FROM cancellation_penalty_records pr
      WHERE pr.id = ANY(p_penalty_ids) AND pr.agency_id = p_agency_id AND pr.status = 'pending'
    ), 0);
  END IF;

  v_payout_code := 'PAY-' || EXTRACT(EPOCH FROM now())::bigint;

  -- Insert the payout record (montos SIEMPRE los recalculados, no los del parametro)
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
    payment_date,
    bank_reference,
    processed_by
  )
  VALUES (
    p_agency_id,
    v_real_net_amount,
    v_real_net_amount,
    v_real_platform_commission,
    p_payment_method,
    p_notes,
    p_receipt_url,
    v_payout_code,
    p_bill_number,
    'completed',
    v_commission_count + v_penalty_count,
    CURRENT_DATE,
    p_bank_reference,
    p_processed_by
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
      AND agency_id = p_agency_id
      AND status = 'pending';
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
    WHERE id = ANY(p_penalty_ids)
      AND agency_id = p_agency_id
      AND status = 'pending';
  END IF;

  RETURN jsonb_build_object(
    'payout_id', v_payout_id,
    'commission_count', v_commission_count,
    'penalty_count', v_penalty_count,
    'net_amount', v_real_net_amount,
    'platform_commission_amount', v_real_platform_commission
  );
END;
$function$
;
