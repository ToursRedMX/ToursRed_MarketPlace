-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831013100
--   name:    revoke_from_public_deduct_and_redeem_points
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

-- El REVOKE anterior no funciono porque el permiso viene de un GRANT ... TO
-- PUBLIC (visible como "=X" en pg_proc.proacl), no de un grant individual a
-- anon/authenticated. anon y authenticated heredan ejecucion via PUBLIC sin
-- tener su propia entrada en el ACL, asi que revocarles a ellos directamente
-- no quita nada. Hay que revocar de PUBLIC.
REVOKE EXECUTE ON FUNCTION public.deduct_points_for_booking(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_points_for_booking(uuid, integer, numeric) FROM PUBLIC;

-- Asegurar que service_role conserve el acceso (las llamadas legitimas via
-- Edge Functions/webhooks usan la service role key).
GRANT EXECUTE ON FUNCTION public.deduct_points_for_booking(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_points_for_booking(uuid, integer, numeric) TO service_role
;
