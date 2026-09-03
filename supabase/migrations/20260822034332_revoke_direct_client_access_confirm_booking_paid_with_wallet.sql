-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260822034332
--   name:    revoke_direct_client_access_confirm_booking_paid_with_wallet
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

-- Corrige un bypass de autenticacion real: confirm_booking_paid_with_wallet tenia
-- EXECUTE otorgado a anon y authenticated. Su chequeo interno de dueno
-- ("IF auth.uid() IS NOT NULL AND auth.uid() != v_user_id") solo se activa si
-- auth.uid() no es nulo -- una llamada anonima (sin sesion, solo con la
-- publishable key publica) tiene auth.uid() = NULL, por lo que el chequeo se
-- salta por completo. Esto permitia a cualquiera, sin iniciar sesion, llamar
-- esta funcion con el booking_id de OTRO usuario y descontar su ToursRed Cash
-- o puntos, marcando la reserva como pagada.
--
-- Ademas, aunque se corrigiera ese bug puntual, dejar EXECUTE en 'authenticated'
-- permitiria que un usuario autenticado llame esta funcion directo (con
-- auth.uid() = v_user_id, pasando el chequeo de dueno legitimamente) sin pasar
-- nunca por la verificacion de step-up (TOTP) que se esta agregando en la
-- Edge Function 'confirm-booking-wallet-payment'.
--
-- Fix permanente: revocar EXECUTE de anon, authenticated y PUBLIC. Solo
-- service_role puede ejecutarla de aqui en adelante -- es decir, unicamente
-- a traves de la Edge Function nueva, que ya valida dueno + step-up antes de
-- llamar al RPC con su propia service_role key.

REVOKE EXECUTE ON FUNCTION public.confirm_booking_paid_with_wallet(uuid, integer, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.confirm_booking_paid_with_wallet(uuid, integer, numeric, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.confirm_booking_paid_with_wallet(uuid, integer, numeric, text) FROM PUBLIC;

-- Confirma que service_role conserva el acceso (necesario para la Edge Function nueva)
GRANT EXECUTE ON FUNCTION public.confirm_booking_paid_with_wallet(uuid, integer, numeric, text) TO service_role;

;
