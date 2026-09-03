-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831011722
--   name:    fix_null_bypass_deduct_points_partial_cancellation
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

-- Mismo bug de "NULL NOT IN" encontrado en get_cfdi_stats: si v_caller_id es
-- NULL (sin sesion, ej. llamada anonima via PostgREST con la anon key -- esta
-- funcion SI esta otorgada a anon), entonces "v_caller_id <> v_booking_user_id"
-- evalua a NULL, y "v_caller_role NOT IN (...)" tambien evalua a NULL (porque
-- v_caller_role tambien queda NULL). NULL AND NULL = NULL, y el IF nunca
-- dispara la excepcion. La verificacion de p_user_id contra el dueño real de
-- la reserva SI protege parcialmente, pero un atacante que conociera booking_id
-- + el user_id correcto podia llamar esta funcion sin ninguna sesion. Se
-- corrige exigiendo explicitamente que haya una sesion valida.
CREATE OR REPLACE FUNCTION public.deduct_points_for_partial_cancellation(p_booking_id uuid, p_partial_cancellation_id uuid, p_user_id uuid, p_points_to_deduct integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_caller_id uuid;
v_caller_role text;
v_booking_user_id uuid;
v_wallet_id uuid;
v_new_balance integer;
v_current_balance integer;
BEGIN
IF p_points_to_deduct <= 0 THEN
RETURN false;
END IF;

v_caller_id := auth.uid();

IF v_caller_id IS NULL THEN
RAISE EXCEPTION 'Unauthorized: no autenticado';
END IF;

SELECT role INTO v_caller_role FROM users WHERE id = v_caller_id;

SELECT user_id INTO v_booking_user_id
FROM public.bookings
WHERE id = p_booking_id;

IF v_booking_user_id IS NULL THEN
RAISE EXCEPTION 'Booking not found: %', p_booking_id;
END IF;

IF p_user_id <> v_booking_user_id THEN
RAISE EXCEPTION 'p_user_id does not match booking owner';
END IF;

IF v_caller_id <> v_booking_user_id AND COALESCE(v_caller_role, '') NOT IN ('agency', 'admin', 'super_admin') THEN
RAISE EXCEPTION 'Unauthorized: cannot deduct points for booking owned by another user';
END IF;

v_wallet_id := get_or_create_points_wallet(p_user_id);

IF EXISTS (
SELECT 1 FROM toursred_points_transactions
WHERE reference_id = p_partial_cancellation_id
AND type = 'partial_cancellation'
) THEN
RAISE NOTICE 'Points already deducted for partial cancellation %', p_partial_cancellation_id;
RETURN true;
END IF;

SELECT balance INTO v_current_balance
FROM toursred_points_wallets
WHERE id = v_wallet_id;

p_points_to_deduct := LEAST(p_points_to_deduct, v_current_balance);

IF p_points_to_deduct <= 0 THEN
RETURN false;
END IF;

UPDATE toursred_points_wallets
SET balance = balance - p_points_to_deduct,
total_used = total_used + p_points_to_deduct,
updated_at = now()
WHERE id = v_wallet_id
RETURNING balance INTO v_new_balance;

INSERT INTO toursred_points_transactions (
wallet_id, user_id, amount, balance_after, type,
description, reference_id, reference_type
) VALUES (
v_wallet_id, p_user_id, -p_points_to_deduct, v_new_balance,
'partial_cancellation',
'Ajuste de puntos por cancelación parcial de viajero(s)',
p_partial_cancellation_id,
'booking_partial_cancellation'
);

RETURN true;
END;
$function$
;
