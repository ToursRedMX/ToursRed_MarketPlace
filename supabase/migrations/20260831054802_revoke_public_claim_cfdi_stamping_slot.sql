-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831054802
--   name:    revoke_public_claim_cfdi_stamping_slot
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

-- BUG: otorgada a PUBLIC (anon), inserta un registro cfdi_invoices con
-- status='pending' y montos (subtotal, iva, total, tour_amount) tomados
-- directo de los parametros del cliente, sin ninguna verificacion. El unico
-- llamador legitimo (generate-booking-cfdi) usa siempre service_role.
-- Cualquiera sin sesion podia insertar registros CFDI falsos con montos
-- arbitrarios para cualquier booking_id.
REVOKE EXECUTE ON FUNCTION public.claim_cfdi_stamping_slot(uuid, text, uuid, uuid, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cfdi_stamping_slot(uuid, text, uuid, uuid, text, text, text, text, text, text, text, numeric, numeric, numeric, numeric, numeric) TO service_role
;
