
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'paypal_client_secret'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN paypal_client_secret text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'mercadopago_access_token'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN mercadopago_access_token text DEFAULT '';
  END IF;
END $$;
