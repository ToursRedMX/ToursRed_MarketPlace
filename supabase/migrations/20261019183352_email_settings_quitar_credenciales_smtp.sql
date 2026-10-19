-- Todo el correo sale por la API HTTP de SMTP2GO (email_settings.smtp_api_key).
-- Ninguna Edge Function ni el front leen host/puerto/usuario/contrasena SMTP
-- (verificado con grep el 19-oct-2026), asi que dejar la contrasena guardada
-- solo es superficie de ataque: el 19-oct se mando spam por esa credencial.
--
-- smtp_password era NOT NULL; al quitar la columna ya nadie tiene que llenarla.
ALTER TABLE public.email_settings
  DROP COLUMN IF EXISTS smtp_host,
  DROP COLUMN IF EXISTS smtp_port,
  DROP COLUMN IF EXISTS smtp_user,
  DROP COLUMN IF EXISTS smtp_password;
