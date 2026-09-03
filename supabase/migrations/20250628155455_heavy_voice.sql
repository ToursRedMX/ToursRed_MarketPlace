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
  END IF;
END $$;

-- Add comments to the new columns
COMMENT ON COLUMN destinations.main_image_base64 IS 'Main image in base64 format (maximum 5MB)';
COMMENT ON COLUMN destinations.main_image_type IS 'MIME type of the main image (image/jpeg, image/png, etc.)';
COMMENT ON COLUMN destinations.main_image_size IS 'Size of the main image base64 in bytes';

-- Create or replace the image size validation function if it doesn't exist
CREATE OR REPLACE FUNCTION validate_image_size()
RETURNS TRIGGER AS $$
BEGIN
  -- Validate main image size for destinations
  IF TG_TABLE_NAME = 'destinations' AND NEW.main_image_base64 IS NOT NULL THEN
    IF NEW.main_image_size > 5242880 THEN -- 5MB in bytes
      RAISE EXCEPTION 'Main image size cannot exceed 5MB';
    END IF;
  END IF;
  
  -- Validate destination images size
  IF TG_TABLE_NAME = 'destination_images' AND NEW.image_base64 IS NOT NULL THEN
    IF NEW.image_size > 3145728 THEN -- 3MB in bytes
      RAISE EXCEPTION 'Destination image size cannot exceed 3MB';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for destinations table if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'validate_destination_main_image_size'
  ) THEN
    CREATE TRIGGER validate_destination_main_image_size
      BEFORE INSERT OR UPDATE ON destinations
      FOR EACH ROW
      EXECUTE FUNCTION validate_image_size();
  END IF;
END $$;
