ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS pac_issuer_zip text;
UPDATE platform_settings SET pac_issuer_zip = '11560';