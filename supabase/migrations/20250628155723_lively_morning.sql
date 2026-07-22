-- Add the missing image columns to destinations table if they don't exist
ALTER TABLE destinations 
ADD COLUMN IF NOT EXISTS main_image_base64 text,
ADD COLUMN IF NOT EXISTS main_image_type text,
ADD COLUMN IF NOT EXISTS main_image_size integer;

-- Add comments to the columns
COMMENT ON COLUMN destinations.main_image_base64 IS 'Main image in base64 format (maximum 5MB)';
COMMENT ON COLUMN destinations.main_image_type IS 'MIME type of the main image (image/jpeg, image/png, etc.)';
COMMENT ON COLUMN destinations.main_image_size IS 'Size of the main image base64 in bytes';

-- Create or replace the image size validation function
CREATE OR REPLACE FUNCTION validate_image_size()
RETURNS TRIGGER AS $$
BEGIN
  -- Validate main image size for destinations
  IF TG_TABLE_NAME = 'destinations' AND NEW.main_image_base64 IS NOT NULL THEN
    -- Calculate size if not provided
    IF NEW.main_image_size IS NULL THEN
      NEW.main_image_size := length(NEW.main_image_base64);
    END IF;
    
    -- Limit to 5MB
    IF NEW.main_image_size > 5242880 THEN -- 5MB in bytes
      RAISE EXCEPTION 'Main image size cannot exceed 5MB';
    END IF;
  END IF;
  
  -- Validate destination images size
  IF TG_TABLE_NAME = 'destination_images' AND NEW.image_base64 IS NOT NULL THEN
    -- Calculate size if not provided
    IF NEW.image_size IS NULL THEN
      NEW.image_size := length(NEW.image_base64);
    END IF;
    
    -- Limit to 3MB
    IF NEW.image_size > 3145728 THEN -- 3MB in bytes
      RAISE EXCEPTION 'Destination image size cannot exceed 3MB';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS validate_destination_main_image_size ON destinations;
DROP TRIGGER IF EXISTS validate_destination_image_size ON destinations;

-- Create new trigger for destinations table
CREATE TRIGGER validate_destination_main_image_size
  BEFORE INSERT OR UPDATE ON destinations
  FOR EACH ROW
  EXECUTE FUNCTION validate_image_size();

-- Fix the destination_images trigger if needed
DROP TRIGGER IF EXISTS validate_destination_images_size ON destination_images;
CREATE TRIGGER validate_destination_images_size
  BEFORE INSERT OR UPDATE ON destination_images
  FOR EACH ROW
  EXECUTE FUNCTION validate_image_size();
