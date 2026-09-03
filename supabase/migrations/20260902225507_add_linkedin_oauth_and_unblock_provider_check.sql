-- ============================================================================
-- Esta migracion hace DOS cosas independientes entre si. Van juntas solo
-- porque tocan el MISMO constraint (user_auth_providers_provider_check);
-- no son el mismo cambio ni tienen la misma causa.
--
--   (A) Alta de LinkedIn (OIDC) como quinto proveedor OAuth.  -> cambio nuevo
--   (B) Desbloqueo de las altas de Microsoft y X, rotas desde -> bug preexistente
--       antes de este PR.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- (A) NUEVO PROVEEDOR: LinkedIn (OIDC)
--
-- Razon: se agrega LinkedIn como quinto proveedor OAuth, replicando el patron
-- de Google / Microsoft / X / Facebook. El provider ya esta configurado a mano
-- en el Dashboard de Supabase Auth como "LinkedIn (OIDC)"; el string que usa
-- signInWithOAuth es 'linkedin_oidc'.
--
-- Los dos toggles nacen en false a proposito: LinkedIn no debe aparecerle a
-- nadie hasta activarlo manualmente desde AdminSettings, igual que X y
-- Facebook hoy (verificado en platform_settings el 02-sep-2026).
-- ----------------------------------------------------------------------------

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS oauth_linkedin_login_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS oauth_linkedin_link_enabled boolean NOT NULL DEFAULT false;


-- ----------------------------------------------------------------------------
-- (B) BUG PREEXISTENTE, ajeno a LinkedIn: el CHECK bloquea altas de Microsoft y X
--
-- Razon: NO tiene que ver con agregar LinkedIn. Se encontro de paso al revisar
-- el constraint para (A). El CHECK vigente en produccion es
--
--     CHECK (provider IN ('email','google','facebook','apple','microsoft'))
--
-- (verificado contra la base el 02-sep-2026), pero las paginas de alta insertan
-- OTROS literales:
--
--     AzureTravelerSignupPage.tsx:199   -> 'azure'
--     AzureAgencySignupPage.tsx:124     -> 'azure'
--     XAgencySignupPage.tsx:120         -> 'twitter'
--     XTravelerSignupPage.tsx:163       -> 'x'        <-- ojo, ver abajo
--
-- Ninguno de esos 3 valores esta permitido, asi que el upsert final revienta
-- DESPUES de haber creado el usuario en Auth: la cuenta queda a medias. Esto
-- ya pasaba antes de este PR. Es consistente con que user_auth_providers solo
-- tenga filas 'google' (4) y 'email' (4): nadie completo nunca un alta por
-- Microsoft ni por X.
--
-- OJO — las dos paginas de X NO se ponen de acuerdo entre si: la de agencia
-- inserta 'twitter' y la de viajero inserta 'x'. Por eso se permiten AMBOS:
-- admitir solo uno dejaria la mitad del flujo de X rota. Lo correcto a futuro
-- es normalizar el codigo a un unico literal y luego quitar el sobrante de
-- aqui; no se toca en este PR para no cambiar archivos de otros proveedores.
--
-- 'microsoft' y 'apple' se conservan aunque hoy nada los inserta: quitarlos
-- seria un cambio con riesgo propio, ajeno a lo que se busca aqui.
--
-- Verificado el 02-sep-2026 que este constraint es el UNICO punto que valida
-- estos valores: ninguna Edge Function ni el resto del frontend tocan
-- user_auth_providers, y no hay funcion, trigger, vista ni enum en la base que
-- referencie la lista. Las 3 politicas RLS de la tabla solo comparan
-- auth.uid() = user_id.
-- ----------------------------------------------------------------------------

ALTER TABLE public.user_auth_providers
  DROP CONSTRAINT IF EXISTS user_auth_providers_provider_check;

ALTER TABLE public.user_auth_providers
  ADD CONSTRAINT user_auth_providers_provider_check
  CHECK (provider IN (
    -- ya permitidos
    'email',
    'google',
    'facebook',
    'apple',
    'microsoft',
    -- (A) proveedor nuevo
    'linkedin_oidc',
    -- (B) desbloqueo del bug preexistente de Microsoft y X
    'azure',
    'twitter',
    'x'
  ));
