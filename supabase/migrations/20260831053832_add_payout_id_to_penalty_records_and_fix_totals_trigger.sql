-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831053832
--   name:    add_payout_id_to_penalty_records_and_fix_totals_trigger
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

-- BUG ESTRUCTURAL: cancellation_penalty_records no tenia columna payout_id,
-- por lo que no habia forma de saber a que pago especifico pertenece una
-- penalizacion ya procesada. Ademas, el trigger update_payout_totals_trigger
-- (en commission_records) recalculaba agency_payouts.amount sumando SOLO
-- commission_records, sobrescribiendo/perdiendo cualquier monto de
-- penalizacion ya incluido correctamente por process_agency_payout_atomic.
-- CONFIRMADO EN VIVO con prueba controlada (BEGIN/ROLLBACK): un pago de
-- $4,400 comision + $350 penalizacion terminaba con net_amount=$4,750
-- (correcto) pero amount=$4,400 (incorrecto, penalizacion perdida).

ALTER TABLE public.cancellation_penalty_records ADD COLUMN IF NOT EXISTS payout_id uuid REFERENCES public.agency_payouts(id);

-- Actualizar process_agency_payout_atomic para que tambien guarde el
-- payout_id en los registros de penalizacion procesados.
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

  IF v_commission_count > 0 THEN
    UPDATE commission_records
    SET status = 'processed', payout_id = v_payout_id, processed_at = now(),
        payment_method = p_payment_method, payment_notes = p_notes,
        payment_receipt_url = p_receipt_url, payment_receipt_filename = p_receipt_filename,
        notified_at = now()
    WHERE id = ANY(p_commission_ids) AND agency_id = p_agency_id AND status = 'pending';
  END IF;

  IF v_penalty_count > 0 THEN
    UPDATE cancellation_penalty_records
    SET status = 'processed', payout_id = v_payout_id, processed_at = now(),
        payment_method = p_payment_method, payment_notes = p_notes,
        payment_receipt_url = p_receipt_url, payment_receipt_filename = p_receipt_filename
    WHERE id = ANY(p_penalty_ids) AND agency_id = p_agency_id AND status = 'pending';
  END IF;

  RETURN jsonb_build_object(
    'payout_id', v_payout_id, 'commission_count', v_commission_count, 'penalty_count', v_penalty_count,
    'net_amount', v_real_net_amount, 'platform_commission_amount', v_real_platform_commission
  );
END;
$function$;

-- Corregir el trigger para que sume AMBAS tablas (comisiones + penalizaciones)
CREATE OR REPLACE FUNCTION public.update_payout_totals()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_total_amount numeric;
v_count integer;
BEGIN
IF NEW.payout_id IS NOT NULL AND (OLD.payout_id IS NULL OR OLD.payout_id != NEW.payout_id) THEN
SELECT
COALESCE(SUM(agency_net_amount), 0) + COALESCE((
  SELECT SUM(pr.agency_net_amount) FROM cancellation_penalty_records pr WHERE pr.payout_id = NEW.payout_id
), 0),
COUNT(*) + COALESCE((
  SELECT COUNT(*) FROM cancellation_penalty_records pr WHERE pr.payout_id = NEW.payout_id
), 0)
INTO v_total_amount, v_count
FROM commission_records
WHERE payout_id = NEW.payout_id;

UPDATE agency_payouts
SET amount = v_total_amount, commission_records_count = v_count, updated_at = now()
WHERE id = NEW.payout_id;

UPDATE financial_transactions
SET payment_status = 'paid', payout_id = NEW.payout_id, reconciliation_status = 'reconciled'
WHERE booking_id IN (SELECT booking_id FROM commission_records WHERE id = NEW.id);
END IF;

RETURN NEW;
END;
$function$
;
