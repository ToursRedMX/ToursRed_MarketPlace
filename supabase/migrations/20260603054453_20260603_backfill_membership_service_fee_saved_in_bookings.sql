
DO $$
DECLARE
  v_service_charge_rate numeric;
  v_rec record;
  v_full_service_charge numeric;
  v_actual_service_charge numeric;
  v_code_discount numeric;
  v_exemption_used numeric;
BEGIN
  SELECT COALESCE(service_charge_percentage, 5)
  INTO v_service_charge_rate
  FROM public.platform_settings
  LIMIT 1;

  IF v_service_charge_rate IS NULL THEN
    v_service_charge_rate := 5;
  END IF;

  FOR v_rec IN
    SELECT id, total_price, service_charge, service_charge_discount
    FROM public.bookings
    WHERE used_membership_benefit = true
      AND (membership_service_fee_saved IS NULL OR membership_service_fee_saved = 0)
      AND payment_method IN ('toursred_cash', 'toursred_points', 'toursred_points_and_cash')
  LOOP
    v_full_service_charge   := (COALESCE(v_rec.total_price, 0) * v_service_charge_rate) / 100;
    v_actual_service_charge := COALESCE(v_rec.service_charge::numeric, 0);
    v_code_discount         := COALESCE(v_rec.service_charge_discount::numeric, 0);
    v_exemption_used        := v_full_service_charge - v_actual_service_charge - v_code_discount;

    IF v_exemption_used > 0 THEN
      UPDATE public.bookings
      SET membership_service_fee_saved = v_exemption_used
      WHERE id = v_rec.id;
    END IF;
  END LOOP;
END $$;
