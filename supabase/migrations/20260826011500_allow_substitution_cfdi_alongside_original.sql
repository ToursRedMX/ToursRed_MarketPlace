-- La rama de sustitucion de generate-booking-cfdi (commit 424b2ad) no funcionaba.
--
-- Ese commit razono que bastaba con omitir claim_cfdi_stamping_slot, porque ese
-- RPC rechaza con already_exists cuando la reserva ya tiene un CFDI stamped, que
-- es justo el caso de una sustitucion. Correcto en cuanto al RPC, pero la
-- proteccion anti-duplicado no vivia solo ahi: tambien hay un indice unico a
-- nivel de tabla, y saltarse el claim no lo esquiva.
--
-- Al ejecutar el Paso 1 (emitir el sustituto de F-63) por primera vez:
--     duplicate key value violates unique constraint "uq_cfdi_booking"
-- El fallo ocurre en el INSERT, antes de llamar al PAC, asi que no dejaba
-- registros huerfanos ni timbraba nada. La capacidad llevaba desplegada desde el
-- 25-ago sin haberse ejecutado nunca; por eso nadie lo habia visto.
--
-- El indice anterior era:
--   (booking_id) WHERE invoice_type='booking' AND status IN ('pending','stamped')
--
-- Se reemplaza por DOS indices parciales con predicados mutuamente excluyentes
-- (related_cfdi_invoice_id IS NULL / IS NOT NULL). Asi el original y su
-- sustituto no compiten entre si, pero cada categoria sigue limitada a una fila
-- viva por reserva. No se relaja la proteccion: se parte en dos.
--
-- Se indexa por booking_id y no por related_cfdi_invoice_id. Es mas estricto:
-- dos sustitutos del mismo original comparten reserva, asi que tambien chocan, y
-- ademas impide que una reserva acumule sustitutos de originales distintos.
-- Encadenar sigue siendo posible: al cancelar el intermedio, este sale del
-- predicado (status pasa a 'cancelled') y cabe uno nuevo.
--
-- Verificado en ROLLBACK contra la BD real, insertando clones de F-63:
--   1) segundo CFDI normal para la misma reserva -> rechazado (bien)
--   2) sustituto de F-63                         -> permitido (bien)
--   3) segundo sustituto para la misma reserva   -> rechazado (bien)

DROP INDEX IF EXISTS public.uq_cfdi_booking;

-- CFDIs normales: uno vivo por reserva
CREATE UNIQUE INDEX uq_cfdi_booking
  ON public.cfdi_invoices (booking_id)
  WHERE invoice_type = 'booking'
    AND status = ANY (ARRAY['pending'::text, 'stamped'::text])
    AND related_cfdi_invoice_id IS NULL;

-- Sustitutos: uno vivo por reserva, conviviendo con el original
CREATE UNIQUE INDEX uq_cfdi_booking_substitution
  ON public.cfdi_invoices (booking_id)
  WHERE invoice_type = 'booking'
    AND status = ANY (ARRAY['pending'::text, 'stamped'::text])
    AND related_cfdi_invoice_id IS NOT NULL;
