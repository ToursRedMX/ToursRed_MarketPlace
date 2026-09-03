-- Agregar campos base64 a la tabla destinations
ALTER TABLE destinations 
ADD COLUMN IF NOT EXISTS main_image_base64 text,
ADD COLUMN IF NOT EXISTS main_image_size integer,
ADD COLUMN IF NOT EXISTS main_image_type text;

-- Agregar campos base64 a la tabla destination_images
ALTER TABLE destination_images 
ADD COLUMN IF NOT EXISTS image_base64 text,
ADD COLUMN IF NOT EXISTS image_size integer,
ADD COLUMN IF NOT EXISTS image_type text;

-- Función para validar el tamaño de imagen base64
CREATE OR REPLACE FUNCTION validate_image_size()
RETURNS TRIGGER AS $$
BEGIN
  -- Validar tamaño de imagen principal en destinations
  IF TG_TABLE_NAME = 'destinations' AND NEW.main_image_base64 IS NOT NULL THEN
    -- Calcular tamaño aproximado (base64 es ~33% más grande que el archivo original)
    NEW.main_image_size = length(NEW.main_image_base64);
    
    -- Limitar a 5MB (5 * 1024 * 1024 * 1.33 ≈ 7MB en base64)
    IF NEW.main_image_size > 7000000 THEN
      RAISE EXCEPTION 'La imagen principal es demasiado grande. Máximo 5MB permitido.';
    END IF;
  END IF;
  
  -- Validar tamaño de imagen en destination_images
  IF TG_TABLE_NAME = 'destination_images' AND NEW.image_base64 IS NOT NULL THEN
    NEW.image_size = length(NEW.image_base64);
    
    -- Limitar a 3MB por imagen adicional
    IF NEW.image_size > 4000000 THEN
      RAISE EXCEPTION 'La imagen es demasiado grande. Máximo 3MB permitido.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para validación de tamaño
DROP TRIGGER IF EXISTS validate_destination_image_size ON destinations;
CREATE TRIGGER validate_destination_image_size
  BEFORE INSERT OR UPDATE ON destinations
  FOR EACH ROW
  EXECUTE FUNCTION validate_image_size();

DROP TRIGGER IF EXISTS validate_destination_images_size ON destination_images;
CREATE TRIGGER validate_destination_images_size
  BEFORE INSERT OR UPDATE ON destination_images
  FOR EACH ROW
  EXECUTE FUNCTION validate_image_size();

-- Comentarios para documentación
COMMENT ON COLUMN destinations.main_image_base64 IS 'Imagen principal en formato base64 (máximo 5MB)';
COMMENT ON COLUMN destinations.main_image_size IS 'Tamaño de la imagen base64 en bytes';
COMMENT ON COLUMN destinations.main_image_type IS 'Tipo MIME de la imagen (image/jpeg, image/png, etc.)';

COMMENT ON COLUMN destination_images.image_base64 IS 'Imagen en formato base64 (máximo 3MB)';
COMMENT ON COLUMN destination_images.image_size IS 'Tamaño de la imagen base64 en bytes';
COMMENT ON COLUMN destination_images.image_type IS 'Tipo MIME de la imagen (image/jpeg, image/png, etc.)';
