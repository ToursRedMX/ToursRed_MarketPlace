
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'odoo_url'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN odoo_url text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'odoo_api_key_encrypted'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN odoo_api_key_encrypted text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'odoo_database'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN odoo_database text DEFAULT '';
  END IF;
END $$;

-- Actualizar constraint de accounting_provider para incluir odoo
ALTER TABLE platform_settings
  DROP CONSTRAINT IF EXISTS platform_settings_accounting_provider_check;

ALTER TABLE platform_settings
  ADD CONSTRAINT platform_settings_accounting_provider_check
  CHECK (accounting_provider IN ('none', 'zoho_books', 'quickbooks', 'odoo'));
