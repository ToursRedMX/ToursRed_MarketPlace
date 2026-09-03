-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260623233213
--   name:    20260623_add_cleanup_orphaned_identities_cron
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

-- Function to delete auth.identities records whose user_id no longer exists in auth.users
-- Returns the number of deleted rows
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_identities()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer
;


BEGIN
  DELETE FROM auth.identities
  WHERE user_id NOT IN (SELECT id FROM auth.users)
;



  GET DIAGNOSTICS deleted_count = ROW_COUNT
;


  RETURN deleted_count
;


END
;


$$
;



-- Only service_role should call this function
REVOKE ALL ON FUNCTION public.cleanup_orphaned_identities() FROM PUBLIC
;


REVOKE ALL ON FUNCTION public.cleanup_orphaned_identities() FROM anon
;


REVOKE ALL ON FUNCTION public.cleanup_orphaned_identities() FROM authenticated
;



-- Schedule nightly cleanup at 3am UTC via pg_cron (guard: only if extension exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Unschedule if already exists to avoid duplicates
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-orphaned-identities') THEN
      PERFORM cron.unschedule('cleanup-orphaned-identities')
;


    END IF
;



    PERFORM cron.schedule(
      'cleanup-orphaned-identities',
      '0 3 * * *',
      'SELECT public.cleanup_orphaned_identities()'
    )
;


  END IF
;


END
;


$$
;



;
