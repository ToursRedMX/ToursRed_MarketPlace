-- agency_payouts.net_amount y .platform_commission_amount estaban declaradas
-- como `numeric` sin escala, a diferencia de .amount que es numeric(12,2).
-- Sin escala, Postgres guarda el valor tal cual llega, incluido el residuo de
-- punto flotante de JavaScript.
--
-- Sintoma: el payout PAY-1787694694 quedo con
--   amount                     = 78946.26            (limpio: la columna tiene escala)
--   net_amount                 = 78946.25999999998   (sucio: sin escala)
--   platform_commission_amount = 13718.260000000002  (sucio: sin escala)
--
-- amount y net_amount reciben EL MISMO valor desde AdminPayouts.tsx:800-801
-- (ambos salen de paymentDetails.totalAmount), asi que la unica diferencia
-- entre 78946.26 y 78946.25999999998 es el tipo de la columna. Eso descarta a
-- la RPC como origen: el residuo llega ya formado desde el front.
--
-- Origen exacto: AdminPayouts.tsx:740-743 suma las comisiones con reduce() en
-- coma flotante de 64 bits. Los sumandos individuales estan limpios
-- (commission_records.agency_net_amount es numeric(10,2)) y la suma exacta en
-- Postgres da 78946.26; es la acumulacion en JS la que introduce el error.
-- Reproducido: los 7 valores de ese payout sumados con reduce() dan
-- exactamente 78946.25999999998. La suma flotante depende del orden, y esos
-- mismos 7 numeros de comision dan 13718.26, 13718.260000000002 o
-- 13718.259999999998 segun como se ordenen.
--
-- No hace falta un UPDATE de limpieza: ALTER COLUMN ... TYPE numeric(12,2)
-- redondea las filas existentes al cambiar el tipo. Verificado en ROLLBACK
-- contra la BD real: la unica fila afectada (PAY-1787694694) queda en
-- 78946.26 / 13718.26 y no sobran filas con residuo.

-- ---------------------------------------------------------------------------
-- 1. Las dos columnas que produjeron el residuo observado.
-- ---------------------------------------------------------------------------
ALTER TABLE public.agency_payouts
  ALTER COLUMN net_amount TYPE numeric(12,2);

ALTER TABLE public.agency_payouts
  ALTER COLUMN platform_commission_amount TYPE numeric(12,2);

-- ---------------------------------------------------------------------------
-- 2. Las otras cuatro columnas de dinero que tambien quedaron sin escala.
--    Hoy estan limpias, pero tienen la misma exposicion: cualquier valor que
--    llegue con residuo flotante se guarda tal cual.
--
--    discount_amount es la mas delicada: es un campo fiscal y es donde se
--    asientan los puntos como descuento en el CFDI. Sus vecinas de la misma
--    tabla (subtotal, iva_amount, total, tour_amount) ya son numeric(12,2);
--    esta se quedo fuera del patron.
-- ---------------------------------------------------------------------------
ALTER TABLE public.cfdi_invoices
  ALTER COLUMN discount_amount TYPE numeric(12,2);

ALTER TABLE public.commission_records
  ALTER COLUMN late_payment_penalty_total TYPE numeric(12,2);

ALTER TABLE public.commission_records
  ALTER COLUMN late_payment_penalty_commission TYPE numeric(12,2);

ALTER TABLE public.commission_records
  ALTER COLUMN late_payment_penalty_agency_net TYPE numeric(12,2);
