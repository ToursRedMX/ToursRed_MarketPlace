-- Reconcile paid movements that are not guaranteed to arrive through a webhook.
-- Every called creator is idempotent; the date predicates keep the scheduled
-- job bounded and make reruns safe.

ALTER TABLE public.accounting_entries
  DROP CONSTRAINT IF EXISTS accounting_entries_source_type_check;

ALTER TABLE public.accounting_entries
  ADD CONSTRAINT accounting_entries_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'booking', 'payout', 'cancellation', 'manual', 'membership',
    'gift_card', 'gift_card_sale', 'gift_card_redemption', 'gift_card_expiration',
    'featured_slot', 'apertura', 'insurance_settlement', 'insurance_commission',
    'wallet_topup', 'executive_commission', 'insurance', 'supplement',
    'optional_service', 'payment_plan_installment', 'dispute', 'payment_refund'
  ]));

-- The payment-plan table uses `completed`; the historical creator checked only
-- `succeeded`, so installment payments were never reconciled.
CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_payment_plan_installment(p_installment_tx_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx record;
  v_entry_id uuid;
  v_debit text;
  v_total numeric;
  v_service numeric;
  v_net numeric;
BEGIN
  SELECT bpt.*, b.booking_code
  INTO v_tx
  FROM booking_payment_plan_transactions bpt
  JOIN bookings b ON b.id = bpt.booking_id
  WHERE bpt.id = p_installment_tx_id AND bpt.status IN ('completed', 'succeeded');
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_total := COALESCE(v_tx.total_charged, 0);
  v_service := COALESCE(v_tx.service_charge, 0);
  v_net := v_total - v_service;
  IF v_net <= 0 THEN RETURN NULL; END IF;
  v_debit := CASE WHEN v_tx.payment_provider = 'toursred_cash' THEN '218-11' ELSE '102' END;

  SELECT id INTO v_entry_id
  FROM accounting_entries
  WHERE source_type = 'payment_plan_installment' AND source_id = p_installment_tx_id
  LIMIT 1;
  IF v_entry_id IS NOT NULL THEN RETURN NULL; END IF;

  RETURN public.create_accounting_entry_atomic(
    'ingreso',
    'Abono plan de pagos — Reserva: ' || COALESCE(v_tx.booking_code, v_tx.booking_id::text),
    'payment_plan_installment',
    p_installment_tx_id,
    COALESCE(v_tx.created_at::date, current_date),
    jsonb_build_array(
        jsonb_build_object('account_code', v_debit, 'description', 'Cobro abono plan de pagos viajero', 'debit', v_total, 'credit', 0),
        jsonb_build_object('account_code', '402', 'description', 'Cargo de servicio — abono plan de pagos', 'debit', 0, 'credit', v_service),
        jsonb_build_object('account_code', '208', 'description', 'Anticipo pendiente — abono plan de pagos', 'debit', 0, 'credit', v_net)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_paid_accounting_movements(
  p_from_date date DEFAULT (current_date - 90),
  p_to_date date DEFAULT current_date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_result uuid;
  v_counts jsonb := '{}'::jsonb;
  v_count integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Solo el servicio contable puede conciliar movimientos';
  END IF;

  v_count := 0;
  FOR r IN
    SELECT bs.id
    FROM booking_supplements bs
    WHERE bs.status = 'paid'
      AND COALESCE(bs.paid_at, bs.updated_at, bs.created_at)::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.source_type = 'supplement' AND ae.source_id = bs.id)
  LOOP
    v_result := public.create_accounting_entry_for_supplement(r.id);
    IF v_result IS NOT NULL THEN v_count := v_count + 1; END IF;
  END LOOP;
  v_counts := v_counts || jsonb_build_object('supplements', v_count);

  v_count := 0;
  FOR r IN
    SELECT bos.id
    FROM booking_optional_services bos
    WHERE bos.paid_at IS NOT NULL AND bos.is_cancelled IS FALSE
      AND bos.paid_at::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.source_type = 'optional_service' AND ae.source_id = bos.id)
  LOOP
    v_result := public.create_accounting_entry_for_optional_service(r.id);
    IF v_result IS NOT NULL THEN v_count := v_count + 1; END IF;
  END LOOP;
  v_counts := v_counts || jsonb_build_object('optional_services', v_count);

  v_count := 0;
  FOR r IN
    SELECT b.id
    FROM bookings b
    WHERE b.payment_status = 'succeeded' AND b.travel_insurance_included IS TRUE
      AND COALESCE(b.paid_at, b.created_at)::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.source_type = 'insurance' AND ae.source_id = b.id)
  LOOP
    v_result := public.create_accounting_entry_for_insurance_purchase(r.id);
    IF v_result IS NOT NULL THEN v_count := v_count + 1; END IF;
  END LOOP;
  v_counts := v_counts || jsonb_build_object('insurance_purchases', v_count);

  v_count := 0;
  FOR r IN
    SELECT pt.id
    FROM payment_transactions pt
    WHERE pt.status = 'succeeded' AND pt.charge_context = 'membership'
      AND pt.created_at::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.source_type = 'membership' AND ae.source_id = pt.id)
  LOOP
    v_result := public.create_accounting_entry_for_membership(r.id);
    IF v_result IS NOT NULL THEN v_count := v_count + 1; END IF;
  END LOOP;
  v_counts := v_counts || jsonb_build_object('memberships', v_count);

  v_count := 0;
  FOR r IN
    SELECT bpt.id
    FROM booking_payment_plan_transactions bpt
    WHERE bpt.status IN ('completed', 'succeeded') AND bpt.created_at::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.source_type = 'payment_plan_installment' AND ae.source_id = bpt.id)
  LOOP
    v_result := public.create_accounting_entry_for_payment_plan_installment(r.id);
    IF v_result IS NOT NULL THEN v_count := v_count + 1; END IF;
  END LOOP;
  v_counts := v_counts || jsonb_build_object('payment_plan_installments', v_count);

  v_count := 0;
  FOR r IN
    SELECT wt.id
    FROM openpay_wallet_topups wt
    WHERE wt.status = 'completed' AND COALESCE(wt.credited_at, wt.created_at)::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.source_type = 'wallet_topup' AND ae.source_id = wt.id)
  LOOP
    v_result := public.create_accounting_entry_for_wallet_topup(r.id);
    IF v_result IS NOT NULL THEN v_count := v_count + 1; END IF;
  END LOOP;
  v_counts := v_counts || jsonb_build_object('wallet_topups', v_count);

  v_count := 0;
  FOR r IN
    SELECT s.id, s.amount, s.payment_date, s.provider_name, s.reference
    FROM insurance_settlements s
    WHERE s.status = 'completed' AND s.payment_date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.source_type = 'insurance_settlement' AND ae.source_id = s.id)
  LOOP
    v_result := public.create_accounting_entry_atomic(
      'egreso',
      'Liquidación prima de seguros a ' || r.provider_name,
      'insurance_settlement', r.id, r.payment_date,
      jsonb_build_array(
        jsonb_build_object('account_code', '201.01', 'description', 'Pago a ' || r.provider_name, 'debit', r.amount, 'credit', 0),
        jsonb_build_object('account_code', '102', 'description', 'Transferencia liquidación seguro ' || COALESCE(r.reference, ''), 'debit', 0, 'credit', r.amount)
      )
    );
    IF v_result IS NOT NULL THEN v_count := v_count + 1; END IF;
  END LOOP;
  v_counts := v_counts || jsonb_build_object('insurance_settlements', v_count);

  v_count := 0;
  FOR r IN
    SELECT c.id, c.amount, c.receipt_date, c.provider_name, c.invoice_reference
    FROM insurance_commission_receipts c
    WHERE c.status = 'completed' AND c.receipt_date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.source_type = 'insurance_commission' AND ae.source_id = c.id)
  LOOP
    v_result := public.create_accounting_entry_atomic(
      'ingreso',
      'Comisión de ' || r.provider_name || ' por venta de seguros',
      'insurance_commission', r.id, r.receipt_date,
      jsonb_build_array(
        jsonb_build_object('account_code', '102', 'description', 'Comisión recibida de ' || r.provider_name, 'debit', r.amount, 'credit', 0),
        jsonb_build_object('account_code', '401.02', 'description', 'Ingreso comisión seguros ' || COALESCE(r.invoice_reference, ''), 'debit', 0, 'credit', r.amount)
      )
    );
    IF v_result IS NOT NULL THEN v_count := v_count + 1; END IF;
  END LOOP;
  v_counts := v_counts || jsonb_build_object('insurance_commissions', v_count);

  RETURN v_counts || jsonb_build_object('total', (
    SELECT COALESCE(sum(value::integer), 0) FROM jsonb_each_text(v_counts)
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_paid_accounting_movements(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_paid_accounting_movements(date, date) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-accounting-entries-daily') THEN
    PERFORM cron.unschedule('generate-accounting-entries-daily');
  END IF;
  PERFORM cron.schedule(
    'generate-accounting-entries-daily',
    '0 4 * * *',
    $job$SELECT public.generate_accounting_entries_batch(current_date - 1, current_date - 1);
SELECT public.reconcile_executive_commissions_batch(current_date - 1, current_date - 1);
SELECT public.reconcile_paid_accounting_movements(current_date - 1, current_date - 1);$job$
  );
EXCEPTION WHEN undefined_table OR undefined_function THEN
  NULL;
END;
$$;
