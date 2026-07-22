-- Fix: add admin/super_admin guard to commission and accounting summary functions
-- These were callable by any authenticated user since they had no auth check.

-- 1. create_commission_records_for_tour
CREATE OR REPLACE FUNCTION public.create_commission_records_for_tour(p_tour_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_role        text;
  v_tour_record        record;
  v_booking_record     record;
  v_commission_record_id uuid;
  v_created_count      integer := 0;
  v_skipped_count      integer := 0;
  v_rates              record;
BEGIN
  SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RETURN json_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  SELECT t.id, t.agency_id, t.end_date, t.name
  INTO v_tour_record
  FROM public.tours t
  WHERE t.id = p_tour_id
  AND t.end_date < CURRENT_DATE;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Tour no encontrado o no ha finalizado',
      'created_count', 0,
      'skipped_count', 0
    );
  END IF;

  SELECT * INTO v_rates
  FROM public.get_effective_commission_rates(v_tour_record.agency_id, p_tour_id);

  FOR v_booking_record IN
    SELECT b.id AS booking_id, b.agency_id, b.total_price,
           b.commission_amount, b.service_charge, b.platform_revenue
    FROM public.bookings b
    WHERE b.tour_id = p_tour_id
    AND b.status = 'confirmed'
    AND b.payment_status = 'succeeded'
    AND NOT EXISTS (
      SELECT 1 FROM public.commission_records cr WHERE cr.booking_id = b.id
    )
  LOOP
    INSERT INTO public.commission_records (
      booking_id, agency_id, tour_id, tour_end_date, total_tour_price,
      agency_commission_rate, agency_commission_amount, service_charge_rate,
      service_charge_amount, platform_total_revenue, agency_net_amount, status, created_at
    ) VALUES (
      v_booking_record.booking_id, v_booking_record.agency_id, p_tour_id,
      v_tour_record.end_date, v_booking_record.total_price,
      v_rates.agency_commission_rate, v_booking_record.commission_amount,
      v_rates.service_charge_rate, v_booking_record.service_charge,
      v_booking_record.platform_revenue,
      v_booking_record.total_price - v_booking_record.commission_amount,
      'pending', now()
    )
    RETURNING id INTO v_commission_record_id;

    v_created_count := v_created_count + 1;
  END LOOP;

  SELECT COUNT(*) INTO v_skipped_count
  FROM public.bookings b
  WHERE b.tour_id = p_tour_id
  AND b.status = 'confirmed'
  AND b.payment_status = 'succeeded'
  AND EXISTS (SELECT 1 FROM public.commission_records cr WHERE cr.booking_id = b.id);

  RETURN json_build_object(
    'success', true,
    'message', 'Commission records creados exitosamente',
    'tour_name', v_tour_record.name,
    'created_count', v_created_count,
    'skipped_count', v_skipped_count
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'success', false,
    'message', 'Error al crear commission records: ' || SQLERRM,
    'created_count', v_created_count,
    'skipped_count', v_skipped_count
  );
END;
$$;

-- 2. create_commission_records_for_receptivo_slot
CREATE OR REPLACE FUNCTION public.create_commission_records_for_receptivo_slot(p_slot_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_role    text;
  v_slot_record    record;
  v_booking_record record;
  v_created_count  integer := 0;
  v_skipped_count  integer := 0;
  v_rates          record;
BEGIN
  SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
  IF v_caller_role NOT IN ('admin', 'super_admin') THEN
    RETURN json_build_object('success', false, 'message', 'Unauthorized');
  END IF;

  SELECT ts.id, ts.slot_date, ts.departure_time, ts.tour_id,
         t.name AS tour_name, t.agency_id, t.tour_type
  INTO v_slot_record
  FROM public.tour_slots ts
  INNER JOIN public.tours t ON t.id = ts.tour_id
  WHERE ts.id = p_slot_id
  AND ts.slot_date < CURRENT_DATE
  AND t.tour_type = 'receptivo';

  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Slot no encontrado, no pertenece a un tour receptivo, o su fecha aun no ha pasado',
      'created_count', 0,
      'skipped_count', 0
    );
  END IF;

  SELECT * INTO v_rates
  FROM public.get_effective_commission_rates(v_slot_record.agency_id, v_slot_record.tour_id);

  FOR v_booking_record IN
    SELECT b.id AS booking_id, b.agency_id, b.total_price,
           b.commission_amount, b.service_charge, b.platform_revenue
    FROM public.bookings b
    WHERE b.slot_id = p_slot_id
    AND b.status = 'confirmed'
    AND b.payment_status = 'succeeded'
    AND NOT EXISTS (
      SELECT 1 FROM public.commission_records cr WHERE cr.booking_id = b.id
    )
  LOOP
    INSERT INTO public.commission_records (
      booking_id, agency_id, tour_id, tour_end_date, total_tour_price,
      agency_commission_rate, agency_commission_amount, service_charge_rate,
      service_charge_amount, platform_total_revenue, agency_net_amount, status, created_at
    ) VALUES (
      v_booking_record.booking_id, v_booking_record.agency_id, v_slot_record.tour_id,
      v_slot_record.slot_date, v_booking_record.total_price,
      v_rates.agency_commission_rate, v_booking_record.commission_amount,
      v_rates.service_charge_rate, v_booking_record.service_charge,
      v_booking_record.platform_revenue,
      v_booking_record.total_price - v_booking_record.commission_amount,
      'pending', now()
    );

    v_created_count := v_created_count + 1;
  END LOOP;

  SELECT COUNT(*) INTO v_skipped_count
  FROM public.bookings b
  WHERE b.slot_id = p_slot_id
  AND b.status = 'confirmed'
  AND b.payment_status = 'succeeded'
  AND EXISTS (SELECT 1 FROM public.commission_records cr WHERE cr.booking_id = b.id);

  RETURN json_build_object(
    'success', true,
    'message', 'Commission records creados exitosamente',
    'tour_name', v_slot_record.tour_name,
    'slot_date', v_slot_record.slot_date::text,
    'created_count', v_created_count,
    'skipped_count', v_skipped_count
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'success', false,
    'message', 'Error al crear commission records: ' || SQLERRM,
    'created_count', v_created_count,
    'skipped_count', v_skipped_count
  );
END;
$$;

-- 3. get_gift_card_accounting_summary
CREATE OR REPLACE FUNCTION public.get_gift_card_accounting_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_role       text;
  v_pending_balance   numeric := 0;
  v_sold_count        integer := 0;
  v_redeemed_count    integer := 0;
  v_expired_count     integer := 0;
  v_expiration_income numeric := 0;
BEGIN
  SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();
  IF v_caller_role NOT IN ('admin', 'super_admin', 'accountant') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT COALESCE(SUM(l.credit - l.debit), 0)
  INTO v_pending_balance
  FROM accounting_entry_lines l
  WHERE l.account_code = '218-12';

  SELECT COUNT(*) INTO v_sold_count
  FROM accounting_entries WHERE source_type = 'gift_card_sale';

  SELECT COUNT(*) INTO v_redeemed_count
  FROM accounting_entries WHERE source_type = 'gift_card_redemption';

  SELECT COUNT(*) INTO v_expired_count
  FROM gift_cards WHERE status = 'expired';

  SELECT COALESCE(SUM(l.credit), 0)
  INTO v_expiration_income
  FROM accounting_entry_lines l
  JOIN accounting_entries ae ON ae.id = l.entry_id
  WHERE l.account_code = '4090'
  AND ae.source_type = 'gift_card_expiration';

  RETURN jsonb_build_object(
    'pending_balance',   v_pending_balance,
    'sold_count',        v_sold_count,
    'redeemed_count',    v_redeemed_count,
    'expired_count',     v_expired_count,
    'expiration_income', v_expiration_income
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_commission_records_for_tour(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_commission_records_for_receptivo_slot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_gift_card_accounting_summary() TO authenticated;
