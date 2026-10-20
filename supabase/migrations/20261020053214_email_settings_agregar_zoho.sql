-- Zoho Mail (correos transaccionales, cpaas.zoho.com) como tercer proveedor de correo.
-- Solo amplia los valores permitidos; defaults y datos no cambian. La llave es el secreto de
-- Edge Function ZOHO_EMAIL_API_KEY, no una columna.
ALTER TABLE public.email_settings
  DROP CONSTRAINT IF EXISTS email_settings_email_provider_check,
  ADD CONSTRAINT email_settings_email_provider_check
    CHECK (email_provider IN ('smtp2go', 'sendgrid', 'zoho')),
  DROP CONSTRAINT IF EXISTS email_settings_email_fallback_provider_check,
  ADD CONSTRAINT email_settings_email_fallback_provider_check
    CHECK (email_fallback_provider IS NULL OR email_fallback_provider IN ('smtp2go', 'sendgrid', 'zoho'));
