-- Drop the 6 sensitive credential columns from platform_settings
-- These have been migrated to platform_secrets (which is only accessible via service_role)
-- All 32 edge functions and AdminSettings.tsx have been updated to read from platform_secrets

ALTER TABLE platform_settings
  DROP COLUMN IF EXISTS paypal_client_secret,
  DROP COLUMN IF EXISTS mercadopago_access_token,
  DROP COLUMN IF EXISTS pac_api_key_encrypted,
  DROP COLUMN IF EXISTS odoo_api_key_encrypted,
  DROP COLUMN IF EXISTS zoho_client_secret,
  DROP COLUMN IF EXISTS geo_api_key;