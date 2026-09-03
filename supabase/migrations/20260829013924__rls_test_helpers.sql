-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260829013924
--   name:    _rls_test_helpers.sql
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

-- Funcion temporal para RLS tests - sera eliminada en cleanup
CREATE OR REPLACE FUNCTION nature_stay._rls_test_count(p_table text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = nature_stay, pg_temp
AS $$
DECLARE
  v_count int
;


BEGIN
  EXECUTE format('SELECT COUNT(*) FROM %I', p_table) INTO v_count
;


  RETURN v_count::text
;


EXCEPTION WHEN insufficient_privilege THEN
  RETURN 'PERMISSION_DENIED'
;


END
;


$$
;



-- Funcion para simular auth.uid() con un usuario especifico
CREATE OR REPLACE FUNCTION nature_stay._rls_test_as_user(p_user_id uuid, p_role text DEFAULT 'authenticated')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', p_user_id::text,
    'role', p_role,
    'email', 'test@test.local'
  )::text, true)
;


  PERFORM set_config('role', p_role, true)
;


END
;


$$
;
