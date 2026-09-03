-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831033148
--   name:    revoke_public_cancel_booking_optional_services
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

-- Otorgada a PUBLIC sin ningun chequeo de autorizacion. Confirmado que los 6
-- llamadores legitimos (admin-cancel-booking, admin-finalize-cancellation,
-- process-agency-booking-cancellation, process-payment-plan-tour-deadline,
-- process-tour-cancellation, process-traveler-cancellation) SIEMPRE usan
-- service_role internamente. Cualquiera sin sesion podia llamarla directo
-- con cualquier booking_id y p_cancelled_by_agency=true para marcar todos
-- los extras de una reserva ajena como cancelados con reembolso completo
-- (incluyendo cargo de servicio), revirtiendo tambien la exencion de
-- membresia usada. Se revoca el acceso publico (NO se toca la logica
-- interna, que no depende de auth.uid() -- leccion aprendida de la
-- regresion anterior en esta misma sesion).
REVOKE EXECUTE ON FUNCTION public.cancel_booking_optional_services(uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_optional_services(uuid, boolean, boolean) TO service_role
;
