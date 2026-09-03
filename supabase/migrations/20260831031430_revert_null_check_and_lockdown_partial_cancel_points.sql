-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260831031430
--   name:    revert_null_check_and_lockdown_partial_cancel_points
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

-- REGRESION DETECTADA Y CORREGIDA (30-ago-2026): estas 3 funciones son
-- llamadas legitimamente por Edge Functions que usan SUPABASE_SERVICE_ROLE_KEY
-- (webhooks de Stripe/MercadoPago/Openpay, cron process-expired-slot-reschedules,
-- process-partial-cancellation, etc.), contexto donde auth.uid() es SIEMPRE
-- NULL (no hay JWT de usuario, es una llamada de servidor a servidor). El fix
-- de seguridad anterior de hoy agrego "IF v_caller_id IS NULL THEN RAISE
-- EXCEPTION" de forma ciega en estas 3, rompiendo TODOS esos flujos legitimos:
-- deducciones de puntos en cancelaciones parciales, reembolsos de puntos via
-- webhook de Stripe, y las 17 llamadas reales a update_wallet_balance
-- (pagos, reembolsos, recargas, etc. en produccion).
--
-- La leccion: el riesgo real nunca fue "auth.uid() es NULL" en si mismo --
-- es "auth.uid() es NULL Y la funcion esta expuesta a anon/authenticated".
-- update_wallet_balance y refund_points_for_cancelled_booking NUNCA
-- estuvieron expuestas a anon/authenticated (confirmado), asi que el patron
-- original "auth.uid() IS NOT NULL AND auth.uid() != X" ya era seguro para
-- ellas -- se revierte el chequeo ciego agregado por error.
--
-- deduct_points_for_partial_cancellation SI seguia expuesta a anon/authenticated
-- (unica de las 3 con riesgo real), asi que aqui se revoca el acceso publico
-- (igual que se hizo con deduct_points_for_booking) EN VEZ de bloquear NULL,
-- preservando el flujo legitimo de service_role.

REVOKE EXECUTE ON FUNCTION public.deduct_points_for_partial_cancellation(uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_points_for_partial_cancellation(uuid, uuid, uuid, integer) TO service_role;

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

-- Permite llamadas de servicio (auth.uid() NULL, ya protegidas por el
-- acceso restringido a service_role) o del dueño real / staff de agencia / admin.
IF v_caller_id IS NOT NULL AND v_caller_id <> v_booking_user_id AND COALESCE(v_caller_role, '') NOT IN ('agency', 'admin', 'super_admin') THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.refund_points_for_cancelled_booking(p_booking_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_caller_id uuid;
v_caller_role text;
v_booking_user_id uuid;
v_points_used integer;
v_wallet_id uuid;
v_new_balance integer;
v_current_total_used integer;
BEGIN
v_caller_id := auth.uid();
SELECT role INTO v_caller_role FROM users WHERE id = v_caller_id;

SELECT user_id, COALESCE(points_used, 0)
INTO v_booking_user_id, v_points_used
FROM public.bookings
WHERE id = p_booking_id;

IF v_booking_user_id IS NULL THEN
RAISE EXCEPTION 'Booking not found: %', p_booking_id;
END IF;

IF v_caller_id IS NOT NULL AND v_caller_id <> v_booking_user_id AND COALESCE(v_caller_role, '') NOT IN ('agency', 'admin', 'super_admin') THEN
RAISE EXCEPTION 'Unauthorized: cannot refund points for booking owned by another user';
END IF;

IF v_points_used <= 0 THEN
RETURN true;
END IF;

v_wallet_id := get_or_create_points_wallet(v_booking_user_id);

IF EXISTS (
SELECT 1 FROM public.toursred_points_transactions
WHERE reference_id = p_booking_id
AND type = 'refunded'
) THEN
RAISE NOTICE 'Points already refunded for booking %', p_booking_id;
RETURN true;
END IF;

SELECT total_used INTO v_current_total_used
FROM public.toursred_points_wallets
WHERE id = v_wallet_id;

UPDATE public.toursred_points_wallets
SET balance = balance + v_points_used,
total_used = GREATEST(0, total_used - v_points_used),
updated_at = now()
WHERE id = v_wallet_id
RETURNING balance INTO v_new_balance;

INSERT INTO public.toursred_points_transactions (
wallet_id,
user_id,
amount,
balance_after,
type,
description,
reference_id,
reference_type
) VALUES (
v_wallet_id,
v_booking_user_id,
v_points_used,
v_new_balance,
'refunded',
'Reembolso por cancelación de reserva',
p_booking_id,
'booking'
);

RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_wallet_balance(p_user_id uuid, p_amount numeric, p_type toursred_cash_transaction_type, p_description text, p_reference_id uuid DEFAULT NULL::uuid, p_reference_type text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_caller_id uuid;
v_caller_role text;
v_wallet_id uuid;
v_current_balance decimal;
v_new_balance decimal;
v_transaction_id uuid;
v_existing json;
BEGIN
v_caller_id := auth.uid();
SELECT role INTO v_caller_role FROM users WHERE id = v_caller_id;

IF v_caller_id IS NOT NULL AND v_caller_id <> p_user_id AND COALESCE(v_caller_role, '') NOT IN ('agency', 'admin', 'super_admin') THEN
RAISE EXCEPTION 'Unauthorized: cannot modify wallet of another user';
END IF;

SELECT id, balance INTO v_wallet_id, v_current_balance
FROM public.toursred_cash_wallets
WHERE user_id = p_user_id AND is_active = true
FOR UPDATE;

IF v_wallet_id IS NULL THEN
RAISE EXCEPTION 'Wallet not found for user %', p_user_id;
END IF;

IF p_idempotency_key IS NOT NULL THEN
SELECT json_build_object(
'success', true,
'transaction_id', t.id,
'previous_balance', t.balance_after - t.amount,
'amount', t.amount,
'new_balance', t.balance_after,
'idempotent_replay', true
) INTO v_existing
FROM public.toursred_cash_transactions t
WHERE t.wallet_id = v_wallet_id AND t.idempotency_key = p_idempotency_key
LIMIT 1;

IF v_existing IS NOT NULL THEN
RETURN v_existing;
END IF;
END IF;

v_new_balance := v_current_balance + p_amount;

IF v_new_balance < 0 THEN
RAISE EXCEPTION 'Insufficient balance. Current: %, Attempting: %', v_current_balance, p_amount;
END IF;

UPDATE public.toursred_cash_wallets
SET balance = v_new_balance
WHERE id = v_wallet_id;

INSERT INTO public.toursred_cash_transactions (
wallet_id,
user_id,
amount,
balance_after,
type,
description,
reference_id,
reference_type,
idempotency_key
) VALUES (
v_wallet_id,
p_user_id,
p_amount,
v_new_balance,
p_type,
p_description,
p_reference_id,
p_reference_type,
p_idempotency_key
) RETURNING id INTO v_transaction_id;

RETURN json_build_object(
'success', true,
'transaction_id', v_transaction_id,
'previous_balance', v_current_balance,
'amount', p_amount,
'new_balance', v_new_balance
);
END;
$function$
;
