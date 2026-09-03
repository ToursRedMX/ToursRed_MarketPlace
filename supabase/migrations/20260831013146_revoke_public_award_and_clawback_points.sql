-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831013146
--   name:    revoke_public_award_and_clawback_points
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

-- Mismo patron y mismo fix que deduct_points_for_booking/redeem_points_for_booking:
-- ambas solo se llaman desde webhooks (mercadopago/paypal/stripe) con service_role,
-- pero estaban otorgadas a PUBLIC. claw_back_points_for_refund es aun mas grave
-- porque no tenia NINGUN chequeo de autorizacion (ni siquiera el bypasseable
-- "auth.uid() IS NOT NULL AND..."), asi que cualquiera con la anon key podia
-- reversar puntos de cualquier usuario sin restriccion alguna.
REVOKE EXECUTE ON FUNCTION public.award_points_for_booking(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_points_for_booking(uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claw_back_points_for_refund(uuid, uuid, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claw_back_points_for_refund(uuid, uuid, text, uuid, integer) TO service_role
;
