/*
# Add openpay_public_key to platform_settings

## Description
Adds a new column `openpay_public_key` to the `platform_settings` table so the
OpenPay public key can be stored in the database and configured from the admin
settings panel, instead of being hardcoded in the frontend.

## Changes
- New column: `openpay_public_key` (text, nullable, default null)
  - Stores the OpenPay public key (e.g. `pk_c1a41b41ef394c669447a18b50c081bc`)
  - This is a PUBLIC key — safe to expose to the frontend. It is NOT a secret.
  - Nullable so existing rows are not affected.

## Security
- No new RLS policies needed. The existing `platform_settings` policies already
  allow public SELECT (needed for booking calculations) and admin-only UPDATE.
  The public key is intentionally readable by everyone, same as other public
  payment provider keys like `mercadopago_public_key`.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings' AND column_name = 'openpay_public_key'
  ) THEN
    ALTER TABLE platform_settings ADD COLUMN openpay_public_key text DEFAULT null;
  END IF;
END $$;
