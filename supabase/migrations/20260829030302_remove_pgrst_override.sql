-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260829030302
--   name:    remove_pgrst_override
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

/*
# Remove manual pgrst.db_schemas override from authenticator role

1. Purpose
   - The Supabase Dashboard now manages `nature_stay` in the Exposed Schemas list
     (Project Settings → Data API → Exposed Schemas).
   - The manual `ALTER ROLE authenticator SET pgrst.db_schemas` override is no longer
     needed and should be removed so the Dashboard configuration is the single source of truth.

2. What changes
   - `ALTER ROLE authenticator RESET pgrst.db_schemas` — removes the manual override.
   - `NOTIFY pgrst, 'reload config'` and `NOTIFY pgrst, 'reload schema'` — applies immediately.

3. What does NOT change
   - No tables, views, functions, triggers, RLS policies, grants, default privileges, or roles.
   - Other authenticator settings (statement_timeout, lock_timeout, session_preload_libraries) remain intact.
   - The Dashboard-managed Exposed Schemas list (public, graphql_public, corporate, nature_stay) is now authoritative.
*/
ALTER ROLE authenticator RESET pgrst.db_schemas
;


NOTIFY pgrst, 'reload config'
;


NOTIFY pgrst, 'reload schema'
;



;
