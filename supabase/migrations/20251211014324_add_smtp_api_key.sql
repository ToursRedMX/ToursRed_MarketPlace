
-- Add smtp_api_key column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_settings' AND column_name = 'smtp_api_key'
  ) THEN
    ALTER TABLE email_settings ADD COLUMN smtp_api_key text;
  END IF;
END $$;

-- Update existing row with the API key
UPDATE email_settings 
SET smtp_api_key = 'api-D1F65BD8A6DC496489C600EC517B9FF1'
WHERE smtp_api_key IS NULL OR smtp_api_key = '';
