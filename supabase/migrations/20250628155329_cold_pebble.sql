-- Add the missing image columns to destinations table
DO $$
BEGIN
  -- Add main_image_base64 column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'destinations' AND column_name = 'main_image_base64'
  ) THEN
    ALTER TABLE destinations ADD COLUMN main_image_base64 text;
    ALTER TABLE destinations ADD COLUMN main_image_type text;
    ALTER TABLE destinations ADD COLUMN main_image_size integer;
    
    -- Add comments to describe the columns
    COMMENT ON COLUMN destinations.main_image_base64 IS 'Imagen principal en formato base64 (máximo 5MB)';
    COMMENT ON COLUMN destinations.main_image_type IS 'Tipo MIME de la imagen (image/jpeg, image/png, etc.)';
    COMMENT ON COLUMN destinations.main_image_size IS 'Tamaño de la imagen base64 en bytes';
  END IF;
END $$;
