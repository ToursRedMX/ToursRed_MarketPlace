-- === READ-ONLY FUNCTIONS ===

CREATE OR REPLACE FUNCTION public.calculate_available_points(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_wallet_id uuid;
v_available_points integer;
v_is_active boolean;
BEGIN
SELECT id, balance, is_active INTO v_wallet_id, v_available_points, v_is_active
FROM toursred_points_wallets
WHERE user_id = p_user_id;
IF v_wallet_id IS NULL THEN RETURN 0; END IF;
IF NOT v_is_active THEN RETURN 0; END IF;
RETURN COALESCE(v_available_points, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_can_use_points(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_is_active boolean;
v_membership_active boolean;
BEGIN
SELECT is_active INTO v_is_active
FROM toursred_points_wallets
WHERE user_id = p_user_id;
IF v_is_active IS NULL OR NOT v_is_active THEN RETURN false; END IF;
SELECT EXISTS (
SELECT 1 FROM memberships
WHERE user_id = p_user_id AND status = 'active' AND current_period_end > now()
) INTO v_membership_active;
RETURN v_membership_active;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_entry_balance(p_entry_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
total_debit numeric;
total_credit numeric;
BEGIN
SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
INTO total_debit, total_credit
FROM accounting_entry_lines
WHERE entry_id = p_entry_id;
RETURN ABS(total_debit - total_credit) < 0.01;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
SELECT EXISTS (
SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
);
$$;

CREATE OR REPLACE FUNCTION public.get_current_user_agency_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
SELECT id FROM agencies WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_completed_receptivo_slots_with_commission_status()
RETURNS TABLE(slot_id uuid, tour_id uuid, tour_name text, agency_id uuid, agency_name text, slot_date date, selected_time time, days_completed integer, bookings_count bigint, total_revenue numeric, commission_records_exist boolean, commission_records_count bigint, total_commission_pending numeric, total_commission_processed numeric, total_platform_commission_pending numeric, total_platform_commission_processed numeric, payment_status text, ready_for_payout boolean, can_create_commissions boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
ts.id AS slot_id,
t.id AS tour_id,
t.name AS tour_name,
t.agency_id,
a.name AS agency_name,
ts.slot_date,
ts.departure_time AS selected_time,
(CURRENT_DATE - ts.slot_date)::integer AS days_completed,
COUNT(DISTINCT b.id) AS bookings_count,
COALESCE(SUM(b.total_price), 0)::numeric AS total_revenue,
EXISTS(SELECT 1 FROM commission_records cr WHERE cr.booking_id IN (SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded')) AS commission_records_exist,
COALESCE((SELECT COUNT(*) FROM commission_records cr WHERE cr.booking_id IN (SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded')), 0) AS commission_records_count,
COALESCE((SELECT SUM(cr.agency_net_amount) FROM commission_records cr WHERE cr.booking_id IN (SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded') AND cr.status = 'pending'), 0)::numeric AS total_commission_pending,
COALESCE((SELECT SUM(cr.agency_net_amount) FROM commission_records cr WHERE cr.booking_id IN (SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded') AND cr.status = 'processed'), 0)::numeric AS total_commission_processed,
COALESCE((SELECT SUM(cr.agency_commission_amount) FROM commission_records cr WHERE cr.booking_id IN (SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded') AND cr.status = 'pending'), 0)::numeric AS total_platform_commission_pending,
COALESCE((SELECT SUM(cr.agency_commission_amount) FROM commission_records cr WHERE cr.booking_id IN (SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded') AND cr.status = 'processed'), 0)::numeric AS total_platform_commission_processed,
CASE
WHEN NOT EXISTS(SELECT 1 FROM commission_records cr WHERE cr.booking_id IN (SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded')) THEN 'no_commissions'
WHEN NOT EXISTS(SELECT 1 FROM commission_records cr WHERE cr.booking_id IN (SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded') AND cr.status = 'pending') AND EXISTS(SELECT 1 FROM commission_records cr WHERE cr.booking_id IN (SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded') AND cr.status = 'processed') THEN 'processed'
WHEN EXISTS(SELECT 1 FROM commission_records cr WHERE cr.booking_id IN (SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded') AND cr.status = 'pending') AND EXISTS(SELECT 1 FROM commission_records cr WHERE cr.booking_id IN (SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded') AND cr.status = 'processed') THEN 'partial'
ELSE 'pending'
END AS payment_status,
((CURRENT_DATE - ts.slot_date >= 3) AND EXISTS(SELECT 1 FROM commission_records cr WHERE cr.booking_id IN (SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded') AND cr.status = 'pending')) AS ready_for_payout,
(NOT EXISTS(SELECT 1 FROM commission_records cr WHERE cr.booking_id IN (SELECT b2.id FROM bookings b2 WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded')) AND EXISTS(SELECT 1 FROM bookings b2 WHERE b2.slot_id = ts.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded')) AS can_create_commissions
FROM tour_slots ts
INNER JOIN tours t ON t.id = ts.tour_id AND t.tour_type = 'receptivo'
INNER JOIN agencies a ON a.id = t.agency_id
LEFT JOIN bookings b ON b.slot_id = ts.id AND b.status = 'confirmed' AND b.payment_status = 'succeeded'
WHERE ts.slot_date < CURRENT_DATE AND ts.status NOT IN ('cancelado')
GROUP BY ts.id, t.id, t.name, t.agency_id, a.name, ts.slot_date, ts.departure_time
HAVING COUNT(DISTINCT b.id) > 0
ORDER BY ts.slot_date DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_completed_tours_with_commission_status()
RETURNS TABLE(tour_id uuid, tour_name text, agency_id uuid, agency_name text, end_date date, days_completed integer, bookings_count bigint, total_revenue numeric, commission_records_exist boolean, commission_records_count bigint, total_commission_pending numeric, total_commission_processed numeric, total_platform_commission_pending numeric, total_platform_commission_processed numeric, payment_status text, ready_for_payout boolean, can_create_commissions boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
t.id, t.name, t.agency_id, a.name, t.end_date,
(CURRENT_DATE - t.end_date)::integer,
COUNT(DISTINCT b.id),
COALESCE(SUM(b.total_price), 0)::numeric,
EXISTS(SELECT 1 FROM commission_records cr WHERE cr.tour_id = t.id),
COALESCE((SELECT COUNT(*) FROM commission_records cr WHERE cr.tour_id = t.id), 0),
COALESCE((SELECT SUM(cr.agency_net_amount) FROM commission_records cr WHERE cr.tour_id = t.id AND cr.status = 'pending'), 0)::numeric,
COALESCE((SELECT SUM(cr.agency_net_amount) FROM commission_records cr WHERE cr.tour_id = t.id AND cr.status = 'processed'), 0)::numeric,
COALESCE((SELECT SUM(cr.agency_commission_amount) FROM commission_records cr WHERE cr.tour_id = t.id AND cr.status = 'pending'), 0)::numeric,
COALESCE((SELECT SUM(cr.agency_commission_amount) FROM commission_records cr WHERE cr.tour_id = t.id AND cr.status = 'processed'), 0)::numeric,
CASE
WHEN NOT EXISTS(SELECT 1 FROM commission_records cr2 WHERE cr2.tour_id = t.id) THEN 'no_commissions'
WHEN NOT EXISTS(SELECT 1 FROM commission_records cr2 WHERE cr2.tour_id = t.id AND cr2.status = 'pending') AND EXISTS(SELECT 1 FROM commission_records cr2 WHERE cr2.tour_id = t.id AND cr2.status = 'processed') THEN 'processed'
WHEN EXISTS(SELECT 1 FROM commission_records cr2 WHERE cr2.tour_id = t.id AND cr2.status = 'pending') AND EXISTS(SELECT 1 FROM commission_records cr2 WHERE cr2.tour_id = t.id AND cr2.status = 'processed') THEN 'partial'
ELSE 'pending'
END,
((CURRENT_DATE - t.end_date >= 3) AND EXISTS(SELECT 1 FROM commission_records cr2 WHERE cr2.tour_id = t.id AND cr2.status = 'pending')),
(NOT EXISTS(SELECT 1 FROM commission_records cr2 WHERE cr2.tour_id = t.id) AND EXISTS(SELECT 1 FROM bookings b2 WHERE b2.tour_id = t.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded'))
FROM tours t
INNER JOIN agencies a ON a.id = t.agency_id
LEFT JOIN bookings b ON b.tour_id = t.id AND b.status = 'confirmed' AND b.payment_status = 'succeeded'
WHERE t.end_date < CURRENT_DATE
GROUP BY t.id, t.name, t.agency_id, a.name, t.end_date
HAVING COUNT(DISTINCT b.id) > 0
ORDER BY t.end_date DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_points_expiring_soon(days_threshold integer DEFAULT 30)
RETURNS TABLE(user_id uuid, email text, nombre text, points_expiring integer, earliest_expiration timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
u.id, u.email, u.nombre,
SUM(t.amount)::integer,
MIN(t.expires_at)
FROM toursred_points_transactions t
JOIN users u ON u.id = t.user_id
WHERE t.type = 'earned'
AND t.expires_at IS NOT NULL
AND t.expires_at > now()
AND t.expires_at <= now() + make_interval(days => days_threshold)
AND t.amount > 0
GROUP BY u.id, u.email, u.nombre
HAVING SUM(t.amount) > 0
ORDER BY MIN(t.expires_at) ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_remaining_service_fee_exemption(p_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_exemption_used decimal;
v_reset_date timestamptz;
BEGIN
SELECT service_fee_exemption_used, service_fee_exemption_reset_date
INTO v_exemption_used, v_reset_date
FROM public.memberships
WHERE user_id = p_user_id AND status <> 'expired' AND current_period_end > now()
ORDER BY current_period_end DESC LIMIT 1;
IF NOT FOUND THEN RETURN 0; END IF;
IF now() >= v_reset_date THEN RETURN 500; END IF;
RETURN GREATEST(0, 500 - v_exemption_used);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_staff_agency_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
SELECT agency_id FROM agency_staff WHERE user_id = p_user_id AND is_active = true LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_active_membership(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN EXISTS (
SELECT 1 FROM public.memberships
WHERE user_id = p_user_id AND status = 'active' AND current_period_end > now()
);
END;
$$;

CREATE OR REPLACE FUNCTION public.has_manage_messages_permission()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
user_role text;
is_admin boolean;
BEGIN
SELECT role, is_super_admin INTO user_role, is_admin FROM public.users WHERE id = auth.uid();
IF is_admin = true THEN RETURN true; END IF;
IF user_role = 'admin' THEN
RETURN EXISTS (SELECT 1 FROM public.admin_permissions WHERE user_id = auth.uid() AND can_manage_messages = true);
END IF;
RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_manage_travelers_permission()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
user_role text;
is_admin boolean;
BEGIN
SELECT role, is_super_admin INTO user_role, is_admin FROM public.users WHERE id = auth.uid();
IF is_admin = true THEN RETURN true; END IF;
IF user_role = 'admin' THEN
RETURN EXISTS (SELECT 1 FROM public.admin_permissions WHERE user_id = auth.uid() AND can_manage_travelers = true);
END IF;
RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_permission(permission_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
SELECT CASE
WHEN EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_super_admin = true) THEN true
ELSE COALESCE(
(SELECT CASE permission_name
WHEN 'agencies' THEN can_manage_agencies
WHEN 'users' THEN can_manage_users
WHEN 'destinations' THEN can_manage_destinations
WHEN 'reviews' THEN can_manage_reviews
WHEN 'messages' THEN can_manage_messages
WHEN 'settings' THEN can_manage_settings
WHEN 'memberships' THEN can_manage_memberships
ELSE false
END
FROM admin_permissions WHERE user_id = auth.uid()),
false
)
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'super_admin'));
$$;

CREATE OR REPLACE FUNCTION public.is_conversation_participant(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
SELECT EXISTS (
SELECT 1 FROM message_participants
WHERE conversation_id = p_conversation_id AND user_id = auth.uid()
);
$$;

CREATE OR REPLACE FUNCTION public.is_high_risk_traveler(user_id_param uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
no_shows integer;
BEGIN
SELECT no_show_count INTO no_shows FROM public.users WHERE id = user_id_param;
RETURN COALESCE(no_shows, 0) > 3;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_super_admin = true);
END;
$$;

-- === WRITE FUNCTIONS (auth.uid() self-authorizes) ===

CREATE OR REPLACE FUNCTION public.activate_draft_booking(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_booking record;
v_max_capacity integer;
v_total_booked integer;
v_available integer;
BEGIN
SELECT b.id, b.status, b.tour_id, b.travelers_count, b.approval_status
INTO v_booking
FROM bookings b
WHERE b.id = p_booking_id
FOR UPDATE;

IF v_booking IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Reserva no encontrada');
END IF;

IF v_booking.status != 'draft' THEN
RETURN jsonb_build_object('success', true, 'message', 'La reserva ya fue activada');
END IF;

SELECT
COALESCE(CASE WHEN t.available_spots IS NOT NULL AND t.available_spots > 0 THEN t.available_spots ELSE COALESCE(t.max_travelers, 10) END, 10),
COALESCE(SUM(ob.travelers_count), 0)::integer
INTO v_max_capacity, v_total_booked
FROM tours t
LEFT JOIN bookings ob ON ob.tour_id = t.id AND ob.id != p_booking_id
AND (ob.status = 'confirmed' OR (ob.status = 'pending' AND ob.approval_status = 'approved'))
WHERE t.id = v_booking.tour_id
GROUP BY t.id, t.available_spots, t.max_travelers;

v_available := v_max_capacity - v_total_booked;

IF v_booking.travelers_count > v_available THEN
RETURN jsonb_build_object('success', false, 'error', 'No hay suficientes lugares disponibles', 'available_spots', v_available, 'requested', v_booking.travelers_count);
END IF;

UPDATE bookings SET status = 'pending', updated_at = now() WHERE id = p_booking_id;
RETURN jsonb_build_object('success', true, 'available_spots', v_available - v_booking.travelers_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_discount_code(
  p_code text,
  p_user_id uuid,
  p_booking_id uuid DEFAULT NULL::uuid,
  p_gift_card_id uuid DEFAULT NULL::uuid,
  p_membership_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_validation jsonb;
v_code_id uuid;
v_usage_id uuid;
BEGIN
v_validation := validate_discount_code(p_code, p_user_id, NULL);
IF NOT (v_validation->>'valid')::boolean THEN RETURN v_validation; END IF;
v_code_id := (v_validation->>'code_id')::uuid;

INSERT INTO public.discount_code_usage (discount_code_id, user_id, booking_id, gift_card_id, membership_id)
VALUES (v_code_id, p_user_id, p_booking_id, p_gift_card_id, p_membership_id)
RETURNING id INTO v_usage_id;

RETURN jsonb_build_object(
'success', true, 'usage_id', v_usage_id,
'discount_type', v_validation->>'discount_type',
'discount_value', v_validation->>'discount_value',
'applicable_to', v_validation->>'applicable_to'
);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_booking_email_lock(p_booking_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
rows_affected integer;
BEGIN
UPDATE bookings SET confirmation_email_sent = true
WHERE id = p_booking_id AND confirmation_email_sent = false;
GET DIAGNOSTICS rows_affected = ROW_COUNT;
RETURN rows_affected > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_conversation(
  p_title text,
  p_type text,
  p_participant_ids uuid[],
  p_tour_id uuid DEFAULT NULL::uuid,
  p_booking_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_conversation_id uuid;
v_participant_id uuid;
BEGIN
INSERT INTO conversations (title, type, status, tour_id, booking_id, created_by)
VALUES (p_title, p_type, 'active', p_tour_id, p_booking_id, auth.uid())
RETURNING id INTO v_conversation_id;

INSERT INTO message_participants (conversation_id, user_id, role)
VALUES (v_conversation_id, auth.uid(), (SELECT role FROM users WHERE id = auth.uid()));

FOREACH v_participant_id IN ARRAY p_participant_ids LOOP
IF v_participant_id != auth.uid() THEN
INSERT INTO message_participants (conversation_id, user_id, role)
VALUES (v_conversation_id, v_participant_id, (SELECT role FROM users WHERE id = v_participant_id));
END IF;
END LOOP;

RETURN v_conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_available_service_fee_exemption(p_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_exemption_used decimal;
v_reset_date timestamptz;
v_membership_id uuid;
BEGIN
SELECT id, service_fee_exemption_used, service_fee_exemption_reset_date
INTO v_membership_id, v_exemption_used, v_reset_date
FROM public.memberships
WHERE user_id = p_user_id AND status <> 'expired' AND current_period_end > now()
ORDER BY current_period_end DESC LIMIT 1;

IF NOT FOUND THEN RETURN 0; END IF;

IF now() >= v_reset_date THEN
UPDATE public.memberships
SET service_fee_exemption_used = 0,
service_fee_exemption_reset_date = date_trunc('month', now() + interval '1 month')
WHERE id = v_membership_id;
RETURN 500;
END IF;

RETURN GREATEST(0, 500 - v_exemption_used);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_or_create_slot(p_tour_id uuid, p_schedule_id uuid, p_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_slot_id uuid;
v_schedule record;
v_tour record;
BEGIN
SELECT id INTO v_slot_id
FROM public.tour_slots
WHERE tour_id = p_tour_id AND schedule_id = p_schedule_id AND slot_date = p_date AND status != 'cancelado'
LIMIT 1;

IF v_slot_id IS NOT NULL THEN RETURN v_slot_id; END IF;

SELECT * INTO v_schedule FROM public.tour_schedules WHERE id = p_schedule_id;
IF NOT FOUND THEN RAISE EXCEPTION 'Schedule not found: %', p_schedule_id; END IF;

SELECT * INTO v_tour FROM public.tours WHERE id = p_tour_id;
IF NOT FOUND THEN RAISE EXCEPTION 'Tour not found: %', p_tour_id; END IF;

INSERT INTO public.tour_slots (
tour_id, agency_id, schedule_id, slot_date, departure_time, end_date,
capacity, status, is_auto_generated
) VALUES (
p_tour_id, v_tour.agency_id, p_schedule_id, p_date, v_schedule.departure_time,
p_date + COALESCE(v_tour.slot_duration_days, 1) - 1,
COALESCE(v_schedule.slot_capacity, v_tour.default_slot_capacity, COALESCE(v_tour.max_travelers, 20)),
'activo', true
) RETURNING id INTO v_slot_id;

RETURN v_slot_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_geocoding_cache_usage(query_text text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
UPDATE geocoding_cache SET usage_count = usage_count + 1, last_used_at = now()
WHERE search_query = query_text;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_message(
  p_conversation_id uuid,
  p_content text,
  p_message_type text DEFAULT 'text'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_message_id uuid;
v_is_admin boolean;
v_is_participant boolean;
BEGIN
SELECT (role = 'admin') INTO v_is_admin FROM users WHERE id = auth.uid();
SELECT EXISTS (SELECT 1 FROM message_participants WHERE conversation_id = p_conversation_id AND user_id = auth.uid()) INTO v_is_participant;

IF NOT v_is_admin AND NOT v_is_participant THEN
RAISE EXCEPTION 'No tienes permiso para enviar mensajes a esta conversación';
END IF;

INSERT INTO messages (conversation_id, sender_id, content, message_type)
VALUES (p_conversation_id, auth.uid(), p_content, p_message_type)
RETURNING id INTO v_message_id;

UPDATE conversations SET last_message_at = NOW() WHERE id = p_conversation_id;
RETURN v_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_agency_seat_block(
  p_tour_id uuid,
  p_agency_id uuid,
  p_seat_number integer,
  p_block boolean,
  p_block_note text DEFAULT NULL::text,
  p_slot_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_current_status text;
BEGIN
IF NOT EXISTS (SELECT 1 FROM tours WHERE id = p_tour_id AND agency_id = p_agency_id) THEN
RETURN jsonb_build_object('success', false, 'error', 'Sin autorización');
END IF;

SELECT status INTO v_current_status
FROM slot_seat_status
WHERE tour_id = p_tour_id
AND ((p_slot_id IS NULL AND slot_id IS NULL) OR (p_slot_id IS NOT NULL AND slot_id = p_slot_id))
AND seat_number = p_seat_number;

IF p_block THEN
IF v_current_status = 'reservado_online' THEN
RETURN jsonb_build_object('success', false, 'error', 'El asiento tiene una reserva activa');
END IF;

INSERT INTO slot_seat_status (tour_id, slot_id, agency_id, seat_number, status, block_note, blocked_by, blocked_at)
VALUES (p_tour_id, p_slot_id, p_agency_id, p_seat_number, 'bloqueado_agencia', p_block_note, (SELECT auth.uid()), now())
ON CONFLICT (tour_id, slot_id, seat_number)
DO UPDATE SET status = 'bloqueado_agencia', block_note = p_block_note,
blocked_by = (SELECT auth.uid()), blocked_at = now(), booking_id = NULL, updated_at = now();
ELSE
IF v_current_status != 'bloqueado_agencia' THEN
RETURN jsonb_build_object('success', false, 'error', 'El asiento no está bloqueado por la agencia');
END IF;

DELETE FROM slot_seat_status
WHERE tour_id = p_tour_id
AND ((p_slot_id IS NULL AND slot_id IS NULL) OR (p_slot_id IS NOT NULL AND slot_id = p_slot_id))
AND seat_number = p_seat_number AND status = 'bloqueado_agencia';
END IF;

RETURN jsonb_build_object('success', true);
END;
$$;

-- === FINANCIAL FUNCTIONS: Keep DEFINER but restrict to service_role only ===
-- update_wallet_balance and update_booking_payment_status are called by edge functions
-- (stripe-webhook, mercadopago-webhook, etc.) using service_role key.
-- Revoking authenticated EXECUTE prevents direct user calls while keeping service_role access.

REVOKE EXECUTE ON FUNCTION public.update_wallet_balance(uuid, numeric, toursred_cash_transaction_type, text, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_booking_payment_status(uuid, text, text) FROM authenticated;

-- Restore EXECUTE grants for authenticated on all newly converted functions
GRANT EXECUTE ON FUNCTION public.calculate_available_points(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_can_use_points(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_entry_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_user_agency_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_completed_receptivo_slots_with_commission_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_completed_tours_with_commission_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_points_expiring_soon(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_remaining_service_fee_exemption(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_staff_agency_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_active_membership(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_manage_messages_permission() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_manage_travelers_permission() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_participant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_high_risk_traveler(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_draft_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_discount_code(text, uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_booking_email_lock(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_conversation(text, text, uuid[], uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_service_fee_exemption(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_slot(uuid, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_geocoding_cache_usage(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_agency_seat_block(uuid, uuid, integer, boolean, text, uuid) TO authenticated;
