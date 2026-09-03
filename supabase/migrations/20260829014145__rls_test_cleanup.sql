-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260829014145
--   name:    _rls_test_cleanup.sql
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

-- Eliminar funciones helper temporales de RLS testing
DROP FUNCTION IF EXISTS nature_stay._rls_try_count(text)
;


DROP FUNCTION IF EXISTS nature_stay._rls_set_identity(uuid, text)
;


DROP FUNCTION IF EXISTS nature_stay._rls_test_as_user(uuid, text)
;


DROP FUNCTION IF EXISTS nature_stay._rls_test_count(text)
;
