-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260902232749
--   name:    normalize_x_provider_literal
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

-- Normaliza el literal de X en user_auth_providers y quita el sobrante del CHECK.
--
-- 'x' es el valor canonico: es el string que usa Supabase OAuth
-- (signInWithOAuth provider: 'x', y app_metadata?.provider === 'x' en
-- AuthContext.tsx), consistente con google/facebook/azure/linkedin_oidc.
-- XAgencySignupPage.tsx se alinea a 'x' en el mismo PR (#117).
--
-- Verificado: 0 filas con 'twitter' o 'x' en user_auth_providers antes de
-- este cambio, asi que no hace falta backfill.

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
  ))
;
