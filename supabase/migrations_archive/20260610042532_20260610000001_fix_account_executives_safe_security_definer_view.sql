-- Agregar columnas faltantes a account_executives si no existen
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS facturapi_organization_id text;
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS facturapi_configured_at timestamptz;
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS facturapi_api_key_encrypted text;
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS tax_regimen_fiscal text;
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS tax_uso_cfdi text;
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS tax_withhold_isr boolean DEFAULT false;
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS tax_name text;
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS tax_rfc text;
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS tax_address text;
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS tax_zip text;
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS bank_beneficiary text;
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS bank_account_number text;
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS bank_clabe text;
ALTER TABLE public.account_executives ADD COLUMN IF NOT EXISTS profile_photo_url text;

CREATE OR REPLACE VIEW public.account_executives_safe
WITH (security_invoker = true)
AS
SELECT
  id,
  user_id,
  first_name,
  last_name,
  email,
  phone,
  is_active,
  notes,
  hired_at,
  terminated_at,
  created_by,
  created_at,
  updated_at,
  facturapi_organization_id,
  facturapi_configured_at,
  tax_regimen_fiscal,
  tax_uso_cfdi,
  tax_withhold_isr,
  tax_name,
  tax_rfc,
  tax_address,
  tax_zip,
  bank_beneficiary,
  bank_name,
  bank_account_number,
  bank_clabe,
  profile_photo_url,
  (facturapi_api_key_encrypted IS NOT NULL) AS facturapi_configured
FROM account_executives;
