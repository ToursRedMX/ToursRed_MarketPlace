-- Backfill de tour_promotions.times_used contra las reservas reales que ya la
-- usaron (bookings.promotion_id). El contador nunca se habia incrementado
-- (ver 20260926030000), asi que hoy esta en 0 para todas las promociones
-- aunque tengan reservas.
--
-- Aproximacion: se cuenta 1 por reserva que referencia la promocion. Para
-- promociones tipo nxprecio esto puede quedar por debajo del numero real de
-- "grupos" cobrados al precio especial cuando una sola reserva junto varios
-- grupos (ej. viajaron 4 con min_travelers=2 -> 2 grupos en 1 reserva) porque
-- ese dato no se guardo en su momento y no se puede reconstruir con certeza
-- sin volver a evaluar precios historicos. Es una cota inferior razonable en
-- vez del 0 actual, y de aqui en adelante el conteo ya es exacto.
UPDATE public.tour_promotions tp
SET times_used = sub.usos
FROM (
  SELECT promotion_id, COUNT(*) AS usos
  FROM public.bookings
  WHERE promotion_id IS NOT NULL
  GROUP BY promotion_id
) sub
WHERE tp.id = sub.promotion_id
  AND tp.times_used < sub.usos;
