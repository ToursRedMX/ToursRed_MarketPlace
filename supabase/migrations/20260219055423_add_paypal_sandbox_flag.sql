
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'paypal_sandbox'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN paypal_sandbox boolean DEFAULT true;
  END IF;
END $$;

UPDATE platform_settings SET paypal_sandbox = true WHERE paypal_sandbox IS NULL;
