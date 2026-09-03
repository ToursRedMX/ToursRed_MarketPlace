-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831050459
--   name:    lockdown_membership_exemption_and_reviews_leak
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

-- apply_membership_service_fee_exemption: confirmado que solo se llama desde
-- 9 webhooks/Edge Functions con service_role. Estaba otorgada a PUBLIC, lo
-- que permitia a cualquiera (incluso sin sesion) llamarla con el user_id de
-- otra persona y consumir su tope mensual de exencion de membresia --
-- vector de sabotaje contra un beneficio de membresia ajeno. Se revoca el
-- acceso publico, NO se toca la logica interna (no depende de auth.uid()).
REVOKE EXECUTE ON FUNCTION public.apply_membership_service_fee_exemption(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_membership_service_fee_exemption(uuid, numeric) TO service_role;

-- get_all_reviews_with_details: 0 referencias en el frontend actual (codigo
-- muerto), pero otorgada a anon -- cualquiera sin sesion podia obtener el
-- email de TODOS los viajeros que han dejado una reseña. Se revoca el
-- acceso publico ya que nada legitimo depende de que sea invocable.
REVOKE EXECUTE ON FUNCTION public.get_all_reviews_with_details() FROM PUBLIC, anon, authenticated
;
