-- Normaliza el literal de X en user_auth_providers y quita el sobrante del CHECK.
--
-- Contexto: la migracion 20260902160000 tuvo que permitir 'twitter' Y 'x' a la
-- vez porque las dos paginas de alta de X no coincidian entre si:
--
--     XAgencySignupPage.tsx:120   -> 'twitter'
--     XTravelerSignupPage.tsx:163 -> 'x'
--
-- Admitir solo uno habria dejado la mitad del flujo roto, asi que se dejaron
-- ambos y se anoto normalizar despues. Esto es ese "despues".
--
-- Se elige 'x' como valor canonico, no 'twitter', porque esta columna guarda
-- consistentemente el string de proveedor de Supabase OAuth ('google',
-- 'facebook', 'azure', 'linkedin_oidc'), y para X ese string es 'x':
--
--     AuthContext.tsx:379   signInWithOAuth({ provider: 'x' })
--     AuthContext.tsx:413   app_metadata?.provider === 'x'
--
-- El nombre de las columnas oauth_twitter_* en platform_settings es un legado
-- de nomenclatura aparte y no cambia aqui: no tiene relacion con el valor que
-- guarda esta columna.
--
-- El commit que acompana a esta migracion alinea XAgencySignupPage a 'x'.
--
-- Seguridad del cambio: verificado el 02-sep-2026 que user_auth_providers no
-- tiene ninguna fila con 'twitter' ni con 'x' (solo 'google' y 'email', 4 y 4),
-- asi que quitar 'twitter' del CHECK no invalida datos existentes ni requiere
-- backfill.
--
-- NO se toca XCallbackPage.tsx, que sigue aceptando 'x' y 'twitter' en
-- app_metadata/identities: eso valida lo que reporta Supabase Auth, que es una
-- cosa distinta de lo que nosotros guardamos en esta tabla.
--
-- 'microsoft' y 'apple' se conservan aunque hoy nada los inserta: quitarlos es
-- un cambio con riesgo propio y ajeno a lo que se busca aqui.

ALTER TABLE public.user_auth_providers
  DROP CONSTRAINT IF EXISTS user_auth_providers_provider_check;

ALTER TABLE public.user_auth_providers
  ADD CONSTRAINT user_auth_providers_provider_check
  CHECK (provider IN (
    'email',
    'google',
    'facebook',
    'apple',
    'microsoft',
    'linkedin_oidc',
    'azure',
    'x'
  ));
