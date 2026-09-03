-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831054835
--   name:    revoke_public_dead_discount_code_appliers
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

-- apply_tour_discount_code y apply_insurance_discount_code: 0 referencias en
-- el codigo actual (codigo muerto, solo aparecen en una migracion
-- archivada), pero seguian otorgadas a PUBLIC (anon). Ninguna verificaba que
-- p_user_id coincidiera con auth.uid(), permitiendo a cualquiera sin sesion
-- "quemar" un codigo de descuento de un solo uso contra la cuenta de otra
-- persona (registrando su uso en discount_code_usage), impidiendole usarlo
-- despues. Se revoca el acceso publico ya que nada legitimo depende de
-- que sean invocables.
REVOKE EXECUTE ON FUNCTION public.apply_tour_discount_code(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_insurance_discount_code(text, uuid, uuid) FROM PUBLIC, anon, authenticated
;
