
DO $$
DECLARE
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT
      wcc.booking_id,
      SUM(wcc.membership_exemption_used) AS total_checkin_exemption
    FROM public.wallet_checkin_charges wcc
    WHERE wcc.membership_exemption_used > 0
    GROUP BY wcc.booking_id
  LOOP
    UPDATE public.bookings
    SET membership_service_fee_saved = COALESCE(membership_service_fee_saved, 0) + v_rec.total_checkin_exemption
    WHERE id = v_rec.booking_id;
  END LOOP;
END $$;
