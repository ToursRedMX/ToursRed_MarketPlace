
UPDATE booking_travelers bt
SET
  promo_discount_per_traveler = ROUND(bt.precio_aplicado * (tp.group_discount_percentage / 100), 2),
  precio_aplicado = ROUND(bt.precio_aplicado * (1 - tp.group_discount_percentage / 100), 2)
FROM bookings b
JOIN tour_promotions tp ON b.promotion_id = tp.id
WHERE bt.booking_id = b.id
  AND b.promotion_id IS NOT NULL
  AND tp.promotion_type = 'grupo_precio_fijo'
  AND tp.group_discount_percentage IS NOT NULL
  AND bt.promo_discount_per_traveler = 0
  AND bt.precio_aplicado > 0;
