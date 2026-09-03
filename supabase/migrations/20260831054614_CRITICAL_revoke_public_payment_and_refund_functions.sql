-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831054614
--   name:    CRITICAL_revoke_public_payment_and_refund_functions
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

-- CRITICO: las 3 estaban otorgadas a PUBLIC (anon + authenticated) sin
-- NINGUN chequeo de autorizacion interno.
--
-- allocate_payment_plan_installment: cualquiera sin sesion podia marcar
-- cualquier plan de pago como pagado por cualquier monto arbitrario, sin que
-- ocurriera ningun cobro real, otorgando ademas puntos de recompensa.
-- Confirmado que los 4 llamadores legitimos (capture-paypal-order,
-- conekta-webhook, openpay-webhook, process-payment-plan-installment) usan
-- siempre service_role.
--
-- process_cancellation_refund: cualquiera sin sesion podia acreditar
-- ToursRed Cash a la cuenta de cualquier usuario y cancelar la reserva de
-- otra persona. Confirmado que los 9 llamadores legitimos usan siempre
-- service_role.
--
-- redeem_checkin_token_atomic: 0 referencias en el codigo actual (codigo
-- muerto), pero permitia canjear cualquier token de check-in adivinado o
-- filtrado.
REVOKE EXECUTE ON FUNCTION public.allocate_payment_plan_installment(uuid, numeric, text, numeric, numeric, text, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_payment_plan_installment(uuid, numeric, text, numeric, numeric, text, uuid, boolean, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.process_cancellation_refund(uuid, numeric, text, text, text, boolean, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_cancellation_refund(uuid, numeric, text, text, text, boolean, text, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION public.redeem_checkin_token_atomic(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_checkin_token_atomic(text, timestamptz) TO service_role
;
