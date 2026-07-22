
-- Función para calcular y actualizar el rating de una agencia
CREATE OR REPLACE FUNCTION update_agency_rating(agency_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  avg_rating numeric;
BEGIN
  -- Calcular el promedio de todas las reseñas de la agencia
  SELECT COALESCE(AVG(rating), 0)
  INTO avg_rating
  FROM agency_reviews
  WHERE agency_id = agency_uuid;

  -- Actualizar el rating de la agencia
  UPDATE agencies
  SET rating = avg_rating,
      updated_at = now()
  WHERE id = agency_uuid;
END;
$$;

-- Trigger para actualizar el rating cuando se inserta una nueva reseña
CREATE OR REPLACE FUNCTION trigger_update_agency_rating_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM update_agency_rating(NEW.agency_id);
  RETURN NEW;
END;
$$;

-- Trigger para actualizar el rating cuando se actualiza una reseña
CREATE OR REPLACE FUNCTION trigger_update_agency_rating_on_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM update_agency_rating(NEW.agency_id);
  RETURN NEW;
END;
$$;

-- Trigger para actualizar el rating cuando se elimina una reseña
CREATE OR REPLACE FUNCTION trigger_update_agency_rating_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM update_agency_rating(OLD.agency_id);
  RETURN OLD;
END;
$$;

-- Crear los triggers
DROP TRIGGER IF EXISTS update_agency_rating_on_review_insert ON agency_reviews;
CREATE TRIGGER update_agency_rating_on_review_insert
  AFTER INSERT ON agency_reviews
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_agency_rating_on_insert();

DROP TRIGGER IF EXISTS update_agency_rating_on_review_update ON agency_reviews;
CREATE TRIGGER update_agency_rating_on_review_update
  AFTER UPDATE ON agency_reviews
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_agency_rating_on_update();

DROP TRIGGER IF EXISTS update_agency_rating_on_review_delete ON agency_reviews;
CREATE TRIGGER update_agency_rating_on_review_delete
  AFTER DELETE ON agency_reviews
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_agency_rating_on_delete();

-- Actualizar los ratings de todas las agencias existentes basándose en sus reseñas actuales
DO $$
DECLARE
  agency_record RECORD;
BEGIN
  FOR agency_record IN SELECT DISTINCT agency_id FROM agency_reviews
  LOOP
    PERFORM update_agency_rating(agency_record.agency_id);
  END LOOP;
END;
$$;
