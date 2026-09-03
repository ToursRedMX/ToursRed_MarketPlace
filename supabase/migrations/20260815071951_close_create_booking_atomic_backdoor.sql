-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260815071951
--   name:    close_create_booking_atomic_backdoor
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

-- Hallazgo #119 (TR-R-016): create_booking_atomic (version without preventa gating)
-- still had EXECUTE granted to 'authenticated', letting clients bypass the
-- preventa-eligibility check enforced by create_booking_atomic_with_preventa.
-- Only the _with_preventa wrapper should be client-invokable; it calls the
-- inner function as SECURITY DEFINER (owner role), so this revoke does not
-- break that internal call path.
REVOKE EXECUTE ON FUNCTION public.create_booking_atomic(jsonb, jsonb, jsonb, text, integer[]) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.create_booking_atomic(jsonb, jsonb, jsonb, text, integer[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_booking_atomic(jsonb, jsonb, jsonb, text, integer[]) FROM PUBLIC
;
