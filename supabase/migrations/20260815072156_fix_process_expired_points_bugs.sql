-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260815072156
--   name:    fix_process_expired_points_bugs
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

-- New finding (surfaced while testing TR-ACJ-005): process_expired_points()
-- has always thrown when it actually finds an expired points row:
--   1) casts v_expired_record.id::text into reference_id, but that column is uuid
--   2) uses reference_type='expiration', which is not in the table's CHECK
--      constraint allow-list (booking/adjustment/promotion/referral/...)
-- The cron job (process-expired-toursred-points) has been reporting "succeeded"
-- only because no real expired rows existed yet to trigger the bug.

-- 1) allow 'expiration' as a legitimate reference_type
ALTER TABLE public.toursred_points_transactions
  DROP CONSTRAINT toursred_points_transactions_reference_type_check;

ALTER TABLE public.toursred_points_transactions
  ADD CONSTRAINT toursred_points_transactions_reference_type_check
  CHECK (reference_type = ANY (ARRAY[
    'booking'::text, 'adjustment'::text, 'promotion'::text, 'referral'::text,
    'booking_partial_cancellation'::text, 'supplement_payment'::text, 'supplement'::text,
    'payment_plan'::text, 'optional_service_payment'::text, 'insurance_payment'::text,
    'post_booking_extra'::text, 'admin_cancellation'::text, 'traveler_cancellation'::text,
    'membership'::text, 'featured_slot'::text, 'expiration'::text
  ]));

-- 2) fix the type cast bug
CREATE OR REPLACE FUNCTION public.process_expired_points()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_expired_record RECORD;
v_total_processed integer := 0;
v_new_balance integer;
BEGIN
FOR v_expired_record IN
SELECT
t.id,
t.wallet_id,
t.user_id,
t.amount
FROM toursred_points_transactions t
WHERE t.type = 'earned'
AND t.expires_at < now()
AND NOT EXISTS (
SELECT 1
FROM toursred_points_transactions e
WHERE e.reference_id = t.id
AND e.type = 'expired'
AND e.reference_type = 'expiration'
)
ORDER BY t.expires_at ASC
LOOP
UPDATE toursred_points_wallets
SET balance = GREATEST(0, balance - v_expired_record.amount),
total_expired = total_expired + v_expired_record.amount,
updated_at = now()
WHERE id = v_expired_record.wallet_id
RETURNING balance INTO v_new_balance;

INSERT INTO toursred_points_transactions (
wallet_id,
user_id,
amount,
balance_after,
type,
description,
reference_type,
reference_id
) VALUES (
v_expired_record.wallet_id,
v_expired_record.user_id,
-v_expired_record.amount,
v_new_balance,
'expired',
format('Expiración de %s puntos (12 meses)', v_expired_record.amount),
'expiration',
v_expired_record.id
);

v_total_processed := v_total_processed + 1;
END LOOP;

RETURN v_total_processed;
END;
$function$
;
