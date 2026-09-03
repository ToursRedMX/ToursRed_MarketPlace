-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260805043006
--   name:    grant_service_role_corporate_schema
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

GRANT USAGE ON SCHEMA corporate TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA corporate TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA corporate TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA corporate GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA corporate GRANT ALL ON SEQUENCES TO service_role
;
