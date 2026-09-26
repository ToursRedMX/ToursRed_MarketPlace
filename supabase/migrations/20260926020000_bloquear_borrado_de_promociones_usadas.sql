-- Borrar una tour_promotions referenciada por reservas reales le quita a esas
-- reservas su referencia historica (bookings.promotion_id se va a NULL por el
-- ON DELETE SET NULL), lo que rompe trazabilidad para conciliacion/reportes.
-- Antes esto se topaba por accidente con un bug no relacionado (ver migracion
-- 20260926010000) que devolvia "Acceso no autorizado" — un mensaje que no
-- explicaba nada. Ahora se bloquea a proposito, con un mensaje que si dice
-- por que.
--
-- La agencia debe desactivar la promocion (is_active = false) en vez de
-- borrarla cuando ya tuvo uso. Solo se puede borrar una promocion que nunca
-- se aplico a ninguna reserva.
CREATE OR REPLACE FUNCTION public.prevent_delete_of_used_tour_promotion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.bookings WHERE promotion_id = OLD.id) THEN
    RAISE EXCEPTION 'No se puede eliminar una promocion que ya fue utilizada en reservas. Desactivala en su lugar.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_delete_of_used_tour_promotion ON public.tour_promotions;

CREATE TRIGGER trg_prevent_delete_of_used_tour_promotion
  BEFORE DELETE ON public.tour_promotions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_delete_of_used_tour_promotion();
