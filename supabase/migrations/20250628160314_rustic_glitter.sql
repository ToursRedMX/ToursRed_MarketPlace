-- Drop and recreate the validate_image_size function to handle both tables correctly
CREATE OR REPLACE FUNCTION validate_image_size()
RETURNS TRIGGER AS $$
BEGIN
  -- For destinations table, check main_image_base64 and main_image_size
  IF TG_TABLE_NAME = 'destinations' THEN
    IF NEW.main_image_base64 IS NOT NULL AND NEW.main_image_size IS NOT NULL THEN
      -- Check if image size exceeds 5MB (5 * 1024 * 1024 bytes)
      IF NEW.main_image_size > 5242880 THEN
        RAISE EXCEPTION 'Image size cannot exceed 5MB';
      END IF;
    END IF;
  END IF;
  
  -- For destination_images table, check image_base64 and image_size
  IF TG_TABLE_NAME = 'destination_images' THEN
    IF NEW.image_base64 IS NOT NULL AND NEW.image_size IS NOT NULL THEN
      -- Check if image size exceeds 3MB (3 * 1024 * 1024 bytes)
      IF NEW.image_size > 3145728 THEN
        RAISE EXCEPTION 'Image size cannot exceed 3MB';
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
