-- LinkedIn (OIDC) como quinto proveedor OAuth.
-- El provider ya esta configurado manualmente en el Dashboard de Supabase Auth
-- como "LinkedIn (OIDC)"; el string que usa signInWithOAuth es 'linkedin_oidc'.

-- 1. Toggles en platform_settings, mismo patron que los otros 4 proveedores.
--    Default false a proposito: LinkedIn no debe aparecerle a nadie hasta que
--    se active manualmente desde AdminSettings, igual que X y Facebook hoy.
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS oauth_linkedin_login_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS oauth_linkedin_link_enabled boolean NOT NULL DEFAULT false;

-- 2. Permitir 'linkedin_oidc' en user_auth_providers.
--    El CHECK vigente en produccion es:
--      CHECK (provider IN ('email','google','facebook','apple','microsoft'))
--    (verificado contra la base el 02-sep-2026). Sin este cambio, el upsert
--    final de LinkedInTravelerSignupPage / LinkedInAgencySignupPage viola el
--    constraint y el alta falla despues de haber creado el usuario en Auth.
--
--    OJO: el CHECK tampoco incluye 'azure' ni 'x', asi que los altas por
--    Microsoft, X y Facebook tienen hoy la misma mina. NO se tocan aqui a
--    proposito, para no cambiar el comportamiento de esos 4 proveedores en un
--    PR de LinkedIn; queda documentado como hallazgo aparte.
ALTER TABLE public.user_auth_providers
  DROP CONSTRAINT IF EXISTS user_auth_providers_provider_check;

ALTER TABLE public.user_auth_providers
  ADD CONSTRAINT user_auth_providers_provider_check
  CHECK (provider IN ('email', 'google', 'facebook', 'apple', 'microsoft', 'linkedin_oidc'));
