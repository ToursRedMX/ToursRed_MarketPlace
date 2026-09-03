-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831053904
--   name:    fix_process_agency_payout_atomic_update_order
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

-- Reordenar: las penalizaciones deben marcarse con payout_id ANTES que las
-- comisiones, porque el trigger update_payout_totals_trigger se dispara al
-- actualizar commission_records y en ese momento necesita que las
-- penalizaciones YA tengan su payout_id asignado para incluirlas en la suma.
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

  INSERT INTO agency_payouts (
    agency_id, amount, net_amount, platform_commission_amount, payment_method,
    notes, receipt_url, payout_code, bill_number, status, commission_records_count,
    payment_date, bank_reference, processed_by
  )
  VALUES (
    p_agency_id, v_real_net_amount, v_real_net_amount, v_real_platform_commission, p_payment_method,
    p_notes, p_receipt_url, v_payout_code, p_bill_number, 'completed', v_commission_count + v_penalty_count,
    CURRENT_DATE, p_bank_reference, p_processed_by
  )
  RETURNING id INTO v_payout_id;

  -- Penalizaciones PRIMERO (sin disparar recalculo propio -- no tienen trigger de totales)
  IF v_penalty_count > 0 THEN
    UPDATE cancellation_penalty_records
    SET status = 'processed', payout_id = v_payout_id, processed_at = now(),
        payment_method = p_payment_method, payment_notes = p_notes,
        payment_receipt_url = p_receipt_url, payment_receipt_filename = p_receipt_filename
    WHERE id = ANY(p_penalty_ids) AND agency_id = p_agency_id AND status = 'pending';
  END IF;

  -- Comisiones DESPUES: dispara update_payout_totals_trigger, que ahora
  -- encontrara las penalizaciones ya vinculadas a este payout_id.
  IF v_commission_count > 0 THEN
    UPDATE commission_records
    SET status = 'processed', payout_id = v_payout_id, processed_at = now(),
        payment_method = p_payment_method, payment_notes = p_notes,
        payment_receipt_url = p_receipt_url, payment_receipt_filename = p_receipt_filename,
        notified_at = now()
    WHERE id = ANY(p_commission_ids) AND agency_id = p_agency_id AND status = 'pending';
  END IF;

  -- Si el payout es SOLO de penalizaciones (sin comisiones), el trigger de
  -- commission_records nunca se dispara -- recalcular aqui directamente
  -- para cubrir ese caso.
  IF v_commission_count = 0 AND v_penalty_count > 0 THEN
    UPDATE agency_payouts SET amount = v_real_net_amount WHERE id = v_payout_id;
  END IF;

  RETURN jsonb_build_object(
    'payout_id', v_payout_id, 'commission_count', v_commission_count, 'penalty_count', v_penalty_count,
    'net_amount', v_real_net_amount, 'platform_commission_amount', v_real_platform_commission
  );
END;
$function$
;
