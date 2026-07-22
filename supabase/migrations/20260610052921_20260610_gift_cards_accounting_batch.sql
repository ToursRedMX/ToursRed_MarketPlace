
CREATE OR REPLACE FUNCTION generate_accounting_entries_batch(
  p_from_date date DEFAULT (CURRENT_DATE - interval '90 days')::date,
  p_to_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_count        integer := 0;
  v_completion_count     integer := 0;
  v_payout_count         integer := 0;
  v_cancellation_count   integer := 0;
  v_gc_sale_count        integer := 0;
  v_gc_redemption_count  integer := 0;
  v_booking              record;
  v_cr                   record;
  v_payout               record;
  v_cancellation         record;
  v_gc                   record;
  v_result               uuid;
BEGIN
  -- ── 1. Bookings con pago exitoso sin póliza de ingreso ──────────────────────
  FOR v_booking IN
    SELECT b.id
    FROM bookings b
    WHERE b.payment_status = 'succeeded'
      AND COALESCE(b.paid_at, b.created_at)::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries ae
        WHERE ae.source_type = 'booking' AND ae.source_id = b.id
          AND ae.entry_type = 'ingreso'
      )
  LOOP
    v_result := create_accounting_entry_for_booking(v_booking.id);
    IF v_result IS NOT NULL THEN
      v_booking_count := v_booking_count + 1;
    END IF;
  END LOOP;

  -- ── 2. Commission records completados sin póliza de devengamiento ────────────
  FOR v_cr IN
    SELECT cr.id
    FROM commission_records cr
    WHERE cr.tour_end_date BETWEEN p_from_date AND p_to_date
      AND cr.status IN ('pending', 'processed', 'paid_out')
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries ae
        WHERE ae.source_type = 'booking' AND ae.source_id = cr.booking_id
          AND ae.description LIKE 'Devengamiento%'
      )
  LOOP
    v_result := create_accounting_entry_for_tour_completion(v_cr.id);
    IF v_result IS NOT NULL THEN
      v_completion_count := v_completion_count + 1;
    END IF;
  END LOOP;

  -- ── 3. Payouts completados sin póliza de egreso ──────────────────────────────
  FOR v_payout IN
    SELECT ap.id
    FROM agency_payouts ap
    WHERE ap.status = 'completed'
      AND ap.payment_date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries ae
        WHERE ae.source_type = 'payout' AND ae.source_id = ap.id
      )
  LOOP
    v_result := create_accounting_entry_for_payout(v_payout.id);
    IF v_result IS NOT NULL THEN
      v_payout_count := v_payout_count + 1;
    END IF;
  END LOOP;

  -- ── 4. Cancelaciones totales de viajero con penalización ────────────────────
  FOR v_cancellation IN
    SELECT bc.id
    FROM booking_cancellations bc
    WHERE bc.cancellation_policy_type IN ('50_percent', 'no_refund')
      AND bc.cancelled_by_agency IS NOT TRUE
      AND COALESCE(bc.cancelled_at, bc.created_at)::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries ae
        WHERE ae.source_type = 'cancellation' AND ae.source_id = bc.id
      )
  LOOP
    v_result := create_accounting_entry_for_cancellation(v_cancellation.id, 'full');
    IF v_result IS NOT NULL THEN
      v_cancellation_count := v_cancellation_count + 1;
    END IF;
  END LOOP;

  -- ── 5. Cancelaciones parciales con penalización ──────────────────────────────
  FOR v_cancellation IN
    SELECT bpc.id
    FROM booking_partial_cancellations bpc
    WHERE bpc.cancellation_policy_type IN ('50_percent', 'no_refund')
      AND COALESCE(bpc.cancelled_at, bpc.created_at)::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries ae
        WHERE ae.source_type = 'cancellation' AND ae.source_id = bpc.id
      )
  LOOP
    v_result := create_accounting_entry_for_cancellation(v_cancellation.id, 'partial');
    IF v_result IS NOT NULL THEN
      v_cancellation_count := v_cancellation_count + 1;
    END IF;
  END LOOP;

  -- ── 6. Cancelaciones por agencia (reserva individual) ───────────────────────
  FOR v_cancellation IN
    SELECT bc.id
    FROM booking_cancellations bc
    WHERE bc.cancelled_by_agency = TRUE
      AND COALESCE(bc.cancelled_at, bc.created_at)::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries ae
        WHERE ae.source_type = 'cancellation' AND ae.source_id = bc.id
      )
  LOOP
    v_result := create_accounting_entry_for_cancellation(v_cancellation.id, 'agency_booking');
    IF v_result IS NOT NULL THEN
      v_cancellation_count := v_cancellation_count + 1;
    END IF;
  END LOOP;

  -- ── 7. Gift cards vendidas sin póliza de venta ───────────────────────────────
  FOR v_gc IN
    SELECT gc.id
    FROM gift_cards gc
    WHERE gc.payment_status = 'paid'
      AND COALESCE(gc.purchased_at, gc.created_at)::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries ae
        WHERE ae.source_type = 'gift_card_sale' AND ae.source_id = gc.id
      )
  LOOP
    v_result := create_accounting_entry_for_gift_card_sale(v_gc.id);
    IF v_result IS NOT NULL THEN
      v_gc_sale_count := v_gc_sale_count + 1;
    END IF;
  END LOOP;

  -- ── 8. Gift cards canjeadas sin póliza de canje ──────────────────────────────
  FOR v_gc IN
    SELECT gc.id
    FROM gift_cards gc
    WHERE gc.status = 'redeemed'
      AND COALESCE(gc.redeemed_at, gc.updated_at)::date BETWEEN p_from_date AND p_to_date
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries ae
        WHERE ae.source_type = 'gift_card_redemption' AND ae.source_id = gc.id
      )
  LOOP
    v_result := create_accounting_entry_for_gift_card_redemption(v_gc.id);
    IF v_result IS NOT NULL THEN
      v_gc_redemption_count := v_gc_redemption_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'bookings_processed',       v_booking_count,
    'completions_processed',    v_completion_count,
    'payouts_processed',        v_payout_count,
    'cancellations_processed',  v_cancellation_count,
    'gift_card_sales',          v_gc_sale_count,
    'gift_card_redemptions',    v_gc_redemption_count,
    'total', v_booking_count + v_completion_count + v_payout_count + v_cancellation_count + v_gc_sale_count + v_gc_redemption_count
  );
END;
$$;
