-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260821212354
--   name:    fix_pg_net_calls_use_apikey_header_for_new_key_format_compat
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

-- Migración de compatibilidad con el nuevo sistema de API keys de Supabase
-- (publishable/secret). Las keys nuevas NO se pueden enviar en el header
-- Authorization: Bearer (son rechazadas por el gateway); deben ir en el
-- header apikey, que acepta tanto el formato legacy (JWT) como el nuevo
-- (sb_secret_/sb_publishable_). Este cambio es retrocompatible: sigue
-- funcionando igual hoy con las keys legacy, y no requiere tocarse de
-- nuevo cuando se desactiven las keys legacy más adelante.
--
-- Afecta 3 funciones que llaman net.http_post hacia Edge Functions:
--   1. notify_executive_by_email (trigger)
--   2. process_expired_slot_reschedules (cron)
--   3. process_membership_renewal_reminders (cron)

CREATE OR REPLACE FUNCTION public.notify_executive_by_email(p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
-- URL y anon key son públicos (no son secretos)
v_supabase_url TEXT := 'https://huzsedewwzjywcpbkjkm.supabase.co';
v_anon_key     TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1enNlZGV3d3pqeXdjcGJramttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwODY3ODksImV4cCI6MjA2MjY2Mjc4OX0.Jrfg9m4qwtIRHKhJ15hV_bqqWCDOYYeX-y1Kt34DGQk';
BEGIN
PERFORM net.http_post(
url     := v_supabase_url || '/functions/v1/send-executive-notification',
headers := jsonb_build_object(
'Content-Type', 'application/json',
'apikey',       v_anon_key
),
body    := p_payload,
timeout_milliseconds := 10000
);
EXCEPTION WHEN OTHERS THEN
RAISE WARNING 'notify_executive_by_email error: %', SQLERRM;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_expired_slot_reschedules()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_request            record;
v_response           record;
v_booking            record;
v_target_slot        record;
v_target_slot2       record;
v_total_refund       numeric(10,2);
v_accepted_count     integer;
v_processed_requests integer := 0;
v_cancelled_bookings integer := 0;
v_result             jsonb;
v_supabase_url       text := 'https://huzsedewwzjywcpbkjkm.supabase.co';
v_service_key        text := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key');
v_request_id         bigint;
BEGIN
-- -----------------------------------------------------------------------
-- Paso 1: Solicitudes con deadline expirado
-- -----------------------------------------------------------------------
FOR v_request IN
SELECT srr.*
FROM slot_reschedule_requests srr
WHERE srr.status = 'pending_responses'
AND srr.response_deadline < now()
LOOP

FOR v_response IN
SELECT r.*
FROM slot_reschedule_responses r
WHERE r.request_id = v_request.id
AND r.response = 'pending'
LOOP

SELECT b.id, b.deposit_amount, b.toursred_cash_used, b.user_id, b.travelers_count, b.agency_id
INTO v_booking
FROM bookings b
WHERE b.id = v_response.booking_id
AND b.status IN ('confirmed', 'pending');

IF NOT FOUND THEN
CONTINUE;
END IF;

v_total_refund := COALESCE(v_booking.deposit_amount, 0) + COALESCE(v_booking.toursred_cash_used, 0);

IF v_total_refund > 0 THEN
PERFORM public.update_wallet_balance(
p_user_id        => v_booking.user_id,
p_amount         => v_total_refund,
p_type           => 'refund'::toursred_cash_transaction_type,
p_description    => 'Reembolso por reagendamiento no respondido a tiempo',
p_reference_id   => v_booking.id,
p_reference_type => 'slot_reschedule_no_response'
);
END IF;

UPDATE bookings
SET
status                       = 'cancelled',
cancelled_at                 = now(),
cancellation_type            = 'slot_reschedule_no_response',
cancellation_refund_amount   = v_total_refund,
has_pending_slot_reschedule  = false,
slot_reschedule_response     = 'auto_cancelled',
slot_reschedule_responded_at = now()
WHERE id = v_booking.id;

UPDATE slot_reschedule_responses
SET
response         = 'auto_cancelled',
confirmed_spot   = false,
responded_at     = now(),
refund_processed = true,
refund_amount    = v_total_refund
WHERE id = v_response.id;

UPDATE tour_slots
SET booked_count = GREATEST(0, booked_count - COALESCE(v_booking.travelers_count, 1))
WHERE id = v_request.original_slot_id;

INSERT INTO notifications (user_id, type, title, message, data)
VALUES (
v_booking.user_id,
'slot_reschedule_auto_cancelled'::notification_type,
'Tu reserva fue cancelada automaticamente',
CASE
WHEN v_total_refund > 0
THEN 'La agencia propuso un nuevo horario al que no respondiste a tiempo. Tu deposito de $' ||
v_total_refund::text || ' fue reembolsado a tu ToursRed Cash.'
ELSE 'La agencia propuso un nuevo horario al que no respondiste a tiempo. Tu reserva fue cancelada sin costo.'
END,
jsonb_build_object(
'request_id',    v_request.id,
'booking_id',    v_booking.id,
'refund_amount', v_total_refund
)
);

-- Email al viajero
SELECT INTO v_request_id net.http_post(
url     := v_supabase_url || '/functions/v1/send-slot-reschedule-auto-cancelled-traveler',
headers := jsonb_build_object(
'Content-Type', 'application/json',
'apikey',       v_service_key
),
body    := jsonb_build_object(
'booking_id',    v_booking.id,
'refund_amount', v_total_refund
),
timeout_milliseconds := 10000
);

-- Email a la agencia
SELECT INTO v_request_id net.http_post(
url     := v_supabase_url || '/functions/v1/send-slot-reschedule-auto-cancelled-agency',
headers := jsonb_build_object(
'Content-Type', 'application/json',
'apikey',       v_service_key
),
body    := jsonb_build_object(
'booking_id',    v_booking.id,
'refund_amount', v_total_refund
),
timeout_milliseconds := 10000
);

v_cancelled_bookings := v_cancelled_bookings + 1;
END LOOP;

UPDATE slot_reschedule_requests
SET
auto_accepted_count = 0,
accepted_count = (
SELECT COUNT(*) FROM slot_reschedule_responses
WHERE request_id = v_request.id AND response = 'accepted'
),
rejected_count = (
SELECT COUNT(*) FROM slot_reschedule_responses
WHERE request_id = v_request.id AND response IN ('rejected', 'auto_cancelled')
)
WHERE id = v_request.id;

SELECT * INTO v_target_slot FROM tour_slots WHERE id = v_request.target_slot_id;

IF v_target_slot IS NOT NULL THEN
UPDATE bookings b
SET
selected_date = v_target_slot.slot_date,
selected_time = v_target_slot.departure_time
FROM slot_reschedule_responses srr
WHERE srr.request_id = v_request.id
AND srr.booking_id = b.id
AND srr.response = 'accepted'
AND srr.confirmed_spot = true
AND b.status IN ('confirmed', 'pending')
AND (b.selected_date IS DISTINCT FROM v_target_slot.slot_date
OR b.selected_time IS DISTINCT FROM v_target_slot.departure_time);
END IF;

IF NOT EXISTS (
SELECT 1 FROM bookings b
JOIN slot_reschedule_responses srr ON srr.booking_id = b.id
WHERE srr.request_id = v_request.id
AND b.status IN ('confirmed', 'pending')
AND b.selected_date = (SELECT slot_date FROM tour_slots WHERE id = v_request.original_slot_id)
) THEN
UPDATE tour_slots
SET
status              = 'cancelado',
cancellation_reason = 'Reagendado: ' || v_request.reason,
cancelled_at        = now()
WHERE id = v_request.original_slot_id
AND status <> 'cancelado';
END IF;

UPDATE slot_reschedule_requests
SET status = 'completed', completed_at = now()
WHERE id = v_request.id;

v_processed_requests := v_processed_requests + 1;
END LOOP;

-- -----------------------------------------------------------------------
-- Paso 2: Solicitudes donde todos ya respondieron voluntariamente
-- -----------------------------------------------------------------------
FOR v_request IN
SELECT srr.*
FROM slot_reschedule_requests srr
WHERE srr.status = 'pending_responses'
AND NOT EXISTS (
SELECT 1 FROM slot_reschedule_responses r
WHERE r.request_id = srr.id
AND r.response = 'pending'
)
LOOP
SELECT * INTO v_target_slot2 FROM tour_slots WHERE id = v_request.target_slot_id;

IF v_target_slot2 IS NOT NULL THEN
UPDATE bookings b
SET
selected_date = v_target_slot2.slot_date,
selected_time = v_target_slot2.departure_time
FROM slot_reschedule_responses srr
WHERE srr.request_id = v_request.id
AND srr.booking_id = b.id
AND srr.response = 'accepted'
AND srr.confirmed_spot = true
AND b.status IN ('confirmed', 'pending')
AND (b.selected_date IS DISTINCT FROM v_target_slot2.slot_date
OR b.selected_time IS DISTINCT FROM v_target_slot2.departure_time);

SELECT COUNT(*) INTO v_accepted_count
FROM slot_reschedule_responses
WHERE request_id = v_request.id AND response = 'accepted';

IF NOT EXISTS (
SELECT 1 FROM bookings b
JOIN slot_reschedule_responses srr ON srr.booking_id = b.id
WHERE srr.request_id = v_request.id
AND b.status IN ('confirmed', 'pending')
AND b.selected_date = (SELECT slot_date FROM tour_slots WHERE id = v_request.original_slot_id)
) THEN
UPDATE tour_slots
SET
status              = 'cancelado',
cancellation_reason = 'Reagendado: ' || v_request.reason,
cancelled_at        = now()
WHERE id = v_request.original_slot_id
AND status <> 'cancelado';
END IF;
END IF;

UPDATE slot_reschedule_requests
SET status = 'completed', completed_at = now()
WHERE id = v_request.id;

v_processed_requests := v_processed_requests + 1;
END LOOP;

v_result := jsonb_build_object(
'processed_requests', v_processed_requests,
'cancelled_bookings', v_cancelled_bookings
);

RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_membership_renewal_reminders()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
membership_record record;
supabase_url text;
service_key text;
request_id bigint;
success_count int := 0;
error_count int := 0;
five_days_from_now_start timestamptz;
five_days_from_now_end timestamptz;
plan_amount text;
v_monthly_price numeric;
v_annual_price numeric;
BEGIN
-- Calculate date range (5 days from now)
five_days_from_now_start := (current_date + interval '5 days')::timestamptz;
five_days_from_now_end := (current_date + interval '5 days' + interval '23 hours 59 minutes 59 seconds')::timestamptz;

-- Get Supabase URL and service key from Vault
supabase_url := 'https://huzsedewwzjywcpbkjkm.supabase.co';
service_key := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key');

-- Read current membership prices from platform_settings
SELECT membership_monthly_price, membership_annual_price
INTO v_monthly_price, v_annual_price
FROM platform_settings
LIMIT 1;

-- Log start
RAISE NOTICE 'Starting renewal reminders check at %', now();
RAISE NOTICE 'Looking for memberships expiring between % and %', five_days_from_now_start, five_days_from_now_end;

-- Find memberships that need renewal reminders
FOR membership_record IN
SELECT
m.id,
m.user_id,
m.plan_type,
m.current_period_end,
u.email,
u.first_name
FROM public.memberships m
INNER JOIN public.users u ON m.user_id = u.id
WHERE m.status = 'active'
AND m.renewal_reminder_sent = false
AND m.current_period_end >= five_days_from_now_start
AND m.current_period_end <= five_days_from_now_end
LOOP
BEGIN
-- Determine plan amount from configured prices
plan_amount := CASE
WHEN membership_record.plan_type = 'monthly' THEN '$' || trim(to_char(v_monthly_price, '999999')) || ' MXN'
ELSE '$' || trim(to_char(v_annual_price, '999999')) || ' MXN'
END;

-- Make HTTP request to send reminder email
SELECT INTO request_id net.http_post(
url := supabase_url || '/functions/v1/send-membership-renewal-reminder',
headers := jsonb_build_object(
'Content-Type', 'application/json',
'apikey',       service_key
),
body := jsonb_build_object(
'email', membership_record.email,
'firstName', COALESCE(membership_record.first_name, 'Viajero'),
'planType', membership_record.plan_type,
'renewalDate', membership_record.current_period_end,
'amount', plan_amount
),
timeout_milliseconds := 30000
);

-- Update membership to mark reminder as sent
UPDATE public.memberships
SET
renewal_reminder_sent = true,
renewal_reminder_sent_at = now()
WHERE id = membership_record.id;

success_count := success_count + 1;

RAISE NOTICE 'Sent renewal reminder for membership % (user: %)', membership_record.id, membership_record.email;

EXCEPTION
WHEN OTHERS THEN
error_count := error_count + 1;
RAISE WARNING 'Error processing membership %: %', membership_record.id, SQLERRM;
END;
END LOOP;

-- Log completion
RAISE NOTICE 'Renewal reminders completed: % successful, % errors', success_count, error_count;

-- Return summary
RETURN jsonb_build_object(
'success', true,
'processed', success_count + error_count,
'successful', success_count,
'failed', error_count,
'timestamp', now()
);
END;
$function$;

;
