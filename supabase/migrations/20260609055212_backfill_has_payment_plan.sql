UPDATE bookings b
SET has_payment_plan = true,
    payment_plan_status = COALESCE(
      NULLIF(b.payment_plan_status, ''),
      bpp.status,
      'active'
    )
FROM booking_payment_plans bpp
WHERE bpp.booking_id = b.id
  AND (b.has_payment_plan = false OR b.has_payment_plan IS NULL);