
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'payment_provider'
  ) THEN
    ALTER TABLE bookings ADD COLUMN payment_provider text DEFAULT 'stripe' CHECK (payment_provider IN ('stripe', 'mercadopago', 'paypal'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'gift_cards' AND column_name = 'payment_provider'
  ) THEN
    ALTER TABLE gift_cards ADD COLUMN payment_provider text DEFAULT 'stripe' CHECK (payment_provider IN ('stripe', 'mercadopago', 'paypal'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'mercadopago_enabled'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN mercadopago_enabled boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'paypal_enabled'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN paypal_enabled boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'mercadopago_public_key'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN mercadopago_public_key text DEFAULT '';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'paypal_client_id'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN paypal_client_id text DEFAULT '';
  END IF;
END $$;
