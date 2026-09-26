-- trg_auto_award_points_on_booking_completion disparaba en CUALQUIER UPDATE a
-- bookings, sin importar que columna cambiara. Eso incluye el UPDATE que hace
-- el ON DELETE SET NULL de bookings.promotion_id cuando se borra una fila de
-- tour_promotions.
--
-- award_points_for_booking() tiene una guarda pensada para el flujo de
-- autoservicio del viajero completando su propia reserva:
--   IF auth.uid() IS NOT NULL AND auth.uid() != v_user_id THEN
--     RAISE EXCEPTION 'Acceso no autorizado';
--   END IF;
-- Cuando el trigger se disparaba por un cambio ajeno (como el promotion_id
-- puesto en NULL por la agencia borrando su promocion), quien actua no es el
-- viajero dueno de la reserva, la guarda revienta, y ni el trigger ni el
-- cascade de la FK atrapan la excepcion: sube tal cual hasta PostgREST como
-- un 400 "Acceso no autorizado" que no tiene nada que ver con permisos.
--
-- El fix es acotar cuando dispara el trigger a cuando de verdad cambian las
-- columnas que le interesan, igual que ya hace trigger_update_no_show_count.
DROP TRIGGER IF EXISTS trg_auto_award_points_on_booking_completion ON public.bookings;

CREATE TRIGGER trg_auto_award_points_on_booking_completion
  BEFORE UPDATE OF status, payment_status ON public.bookings
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.payment_status IS DISTINCT FROM NEW.payment_status
  )
  EXECUTE FUNCTION public.auto_award_points_on_booking_completion();
