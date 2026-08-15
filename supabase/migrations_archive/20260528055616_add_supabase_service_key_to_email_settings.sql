
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_settings' AND column_name = 'internal_service_key'
  ) THEN
    ALTER TABLE email_settings ADD COLUMN internal_service_key text;
  END IF;
END $$;
