-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260902225507
--   name:    add_linkedin_oauth_and_unblock_provider_check
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
-- ----------------------------------------------------------------------------

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS oauth_linkedin_login_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS oauth_linkedin_link_enabled boolean NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- (B) BUG PREEXISTENTE, ajeno a LinkedIn: el CHECK bloquea altas de Microsoft y X
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
  ))
;
