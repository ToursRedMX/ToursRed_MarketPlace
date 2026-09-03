-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831013307
--   name:    revoke_public_orphaned_refund_points_for_cancellation
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

-- refund_points_for_cancellation(uuid) es codigo muerto (0 referencias en
-- src/ ni supabase/functions/) -- la version activa es
-- refund_points_for_cancelled_booking, ya corregida antes. Esta version
-- vieja seguia otorgada a anon con el mismo bypass "auth.uid() IS NOT NULL
-- AND...". Se revoca el acceso publico.
REVOKE EXECUTE ON FUNCTION public.refund_points_for_cancellation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_points_for_cancellation(uuid) TO service_role
;
