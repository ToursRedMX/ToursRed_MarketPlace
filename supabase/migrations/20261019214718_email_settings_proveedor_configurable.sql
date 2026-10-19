-- Proveedor de correo configurable. Hasta hoy todo salia por SMTP2GO, fijo en el codigo de ~69
-- archivos; ahora `_shared/correo/enviarCorreo.ts` lee estas columnas y elige el proveedor.
--
-- Valores permitidos: 'smtp2go' | 'sendgrid' (Twilio SendGrid). La llave de SendGrid NO va aqui:
-- es el secreto de Edge Function SENDGRID_API_KEY, igual que las credenciales de Twilio.
--
-- Defaults: principal = smtp2go y respaldo apagado, o sea el comportamiento de antes. Nada cambia
-- hasta que un admin elige otro en Configuracion.
ALTER TABLE public.email_settings
  ADD COLUMN IF NOT EXISTS email_provider text NOT NULL DEFAULT 'smtp2go',
  ADD COLUMN IF NOT EXISTS email_fallback_provider text,
  ADD COLUMN IF NOT EXISTS email_fallback_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.email_settings
  DROP CONSTRAINT IF EXISTS email_settings_email_provider_check,
  ADD CONSTRAINT email_settings_email_provider_check
    CHECK (email_provider IN ('smtp2go', 'sendgrid')),
  DROP CONSTRAINT IF EXISTS email_settings_email_fallback_provider_check,
  ADD CONSTRAINT email_settings_email_fallback_provider_check
    CHECK (email_fallback_provider IS NULL OR email_fallback_provider IN ('smtp2go', 'sendgrid')),
  -- Un respaldo igual al principal no respalda nada.
  DROP CONSTRAINT IF EXISTS email_settings_respaldo_distinto_check,
  ADD CONSTRAINT email_settings_respaldo_distinto_check
    CHECK (email_fallback_provider IS DISTINCT FROM email_provider),
  -- Encender el respaldo sin elegir proveedor no tiene sentido.
  DROP CONSTRAINT IF EXISTS email_settings_respaldo_requiere_proveedor_check,
  ADD CONSTRAINT email_settings_respaldo_requiere_proveedor_check
    CHECK (NOT email_fallback_enabled OR email_fallback_provider IS NOT NULL);
