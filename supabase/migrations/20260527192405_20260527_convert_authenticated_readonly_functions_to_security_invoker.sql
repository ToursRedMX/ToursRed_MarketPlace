-- Drops preventivos para funciones que cambian return type
DROP FUNCTION IF EXISTS public._get_user_conversations_internal(uuid);
DROP FUNCTION IF EXISTS public.get_account_balances_full(integer, integer);
DROP FUNCTION IF EXISTS public.get_user_conversations();
DROP FUNCTION IF EXISTS public.get_user_notifications(integer, integer, boolean);
DROP FUNCTION IF EXISTS public.get_trial_balance(integer, integer);

-- _get_user_conversations_internal: internal helper, should not be directly callable via REST
CREATE OR REPLACE FUNCTION public._get_user_conversations_internal(p_user_id uuid)
RETURNS TABLE(conversation_id uuid, title text, type text, status text, booking_id uuid, tour_id uuid, tour_title text, unread_count bigint, last_message_content text, last_message_at timestamptz, last_message_sender text, participant_count bigint, other_participant_id uuid, other_participant_name text, other_participant_email text, other_participant_role text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_user_role text;
v_is_admin boolean;
BEGIN
SELECT u.role, (u.role = 'admin')
INTO v_user_role, v_is_admin
FROM users u
WHERE u.id = auth.uid();

IF NOT v_is_admin AND p_user_id != auth.uid() THEN
RAISE EXCEPTION 'No tienes permiso para ver estas conversaciones';
END IF;

RETURN QUERY
SELECT
c.id as conversation_id,
c.title,
c.type,
c.status,
c.booking_id,
c.tour_id,
t.name as tour_title,
COALESCE(
COUNT(m.id) FILTER (
WHERE m.sender_id != p_user_id
AND m.created_at > COALESCE(mp_user.last_read_at, '1970-01-01'::timestamptz)
),
0
)::bigint as unread_count,
latest.content as last_message_content,
latest.created_at as last_message_at,
CASE
WHEN latest_sender.role = 'agency' THEN COALESCE(a.name, latest_sender.first_name || ' ' || latest_sender.last_name)
ELSE latest_sender.first_name || ' ' || latest_sender.last_name
END as last_message_sender,
COUNT(DISTINCT mp_all.user_id)::bigint as participant_count,
other_user.other_id as other_participant_id,
other_user.other_first_name || ' ' || other_user.other_last_name as other_participant_name,
other_user.other_email as other_participant_email,
other_user.other_role as other_participant_role
FROM conversations c
LEFT JOIN message_participants mp_user
ON c.id = mp_user.conversation_id AND mp_user.user_id = p_user_id
LEFT JOIN messages m
ON c.id = m.conversation_id
LEFT JOIN tours t
ON c.tour_id = t.id
LEFT JOIN message_participants mp_all
ON c.id = mp_all.conversation_id
LEFT JOIN LATERAL (
SELECT m2.content, m2.created_at, m2.sender_id
FROM messages m2
WHERE m2.conversation_id = c.id
ORDER BY m2.created_at DESC
LIMIT 1
) latest ON true
LEFT JOIN users latest_sender
ON latest.sender_id = latest_sender.id
LEFT JOIN agencies a
ON latest_sender.id = a.user_id AND latest_sender.role = 'agency'
LEFT JOIN LATERAL (
SELECT
u.id as other_id,
u.first_name as other_first_name,
u.last_name as other_last_name,
u.email as other_email,
u.role as other_role
FROM message_participants mp3
JOIN users u ON mp3.user_id = u.id
WHERE mp3.conversation_id = c.id AND mp3.user_id != p_user_id
LIMIT 1
) other_user ON true
WHERE v_is_admin OR mp_user.user_id IS NOT NULL
GROUP BY
c.id,
c.title,
c.type,
c.status,
c.booking_id,
c.tour_id,
t.name,
mp_user.last_read_at,
latest.content,
latest.created_at,
latest_sender.first_name,
latest_sender.last_name,
latest_sender.role,
a.name,
other_user.other_id,
other_user.other_first_name,
other_user.other_last_name,
other_user.other_email,
other_user.other_role
ORDER BY COALESCE(latest.created_at, c.created_at) DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._get_user_conversations_internal(uuid) FROM anon;

-- get_account_balances_full
CREATE OR REPLACE FUNCTION public.get_account_balances_full(p_year integer, p_month integer)
RETURNS TABLE(code text, name text, account_type text, nature text, level integer, parent_code text, is_system boolean, period_debit numeric, period_credit numeric, period_balance numeric, historic_debit numeric, historic_credit numeric, historic_balance numeric)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH leaf_balances AS (
    SELECT
      coa.code AS acct_code,
      COALESCE(SUM(CASE
        WHEN ae.period_year = p_year AND ae.period_month = p_month AND ae.is_posted = true
        THEN ael.debit ELSE 0 END), 0) AS pd,
      COALESCE(SUM(CASE
        WHEN ae.period_year = p_year AND ae.period_month = p_month AND ae.is_posted = true
        THEN ael.credit ELSE 0 END), 0) AS pc,
      COALESCE(SUM(CASE
        WHEN ae.is_posted = true AND (ae.period_year < p_year OR (ae.period_year = p_year AND ae.period_month <= p_month))
        THEN ael.debit ELSE 0 END), 0) AS hd,
      COALESCE(SUM(CASE
        WHEN ae.is_posted = true AND (ae.period_year < p_year OR (ae.period_year = p_year AND ae.period_month <= p_month))
        THEN ael.credit ELSE 0 END), 0) AS hc
    FROM chart_of_accounts coa
    LEFT JOIN accounting_entry_lines ael ON ael.account_code = coa.code
    LEFT JOIN accounting_entries ae ON ae.id = ael.entry_id
    GROUP BY coa.code
  )
  SELECT
    a.code, a.name, a.account_type, a.nature, a.level, a.parent_code, a.is_system,
    COALESCE((SELECT SUM(lb2.pd) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0),
    COALESCE((SELECT SUM(lb2.pc) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0),
    CASE
      WHEN a.nature = 'deudora' THEN
        COALESCE((SELECT SUM(lb2.pd) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0) -
        COALESCE((SELECT SUM(lb2.pc) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0)
      ELSE
        COALESCE((SELECT SUM(lb2.pc) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0) -
        COALESCE((SELECT SUM(lb2.pd) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0)
    END,
    COALESCE((SELECT SUM(lb2.hd) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0),
    COALESCE((SELECT SUM(lb2.hc) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0),
    CASE
      WHEN a.nature = 'deudora' THEN
        COALESCE((SELECT SUM(lb2.hd) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0) -
        COALESCE((SELECT SUM(lb2.hc) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0)
      ELSE
        COALESCE((SELECT SUM(lb2.hc) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0) -
        COALESCE((SELECT SUM(lb2.hd) FROM leaf_balances lb2 WHERE lb2.acct_code LIKE (a.code || '%')), 0)
    END
  FROM chart_of_accounts a
  WHERE a.is_active = true
  ORDER BY a.code;
END;
$$;

-- get_accounting_sync_stats
CREATE OR REPLACE FUNCTION public.get_accounting_sync_stats()
RETURNS TABLE(provider text, total_synced bigint, total_pending bigint, total_errors bigint, total_skipped bigint, contacts_synced bigint, bookings_synced bigint, payouts_synced bigint, last_sync_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
asl.provider,
COUNT(*) FILTER (WHERE asl.status = 'synced') AS total_synced,
COUNT(*) FILTER (WHERE asl.status = 'pending') AS total_pending,
COUNT(*) FILTER (WHERE asl.status = 'error') AS total_errors,
COUNT(*) FILTER (WHERE asl.status = 'skipped') AS total_skipped,
COUNT(*) FILTER (WHERE asl.status = 'synced' AND asl.record_type IN ('contact_agency', 'contact_traveler')) AS contacts_synced,
COUNT(*) FILTER (WHERE asl.status = 'synced' AND asl.record_type = 'booking') AS bookings_synced,
COUNT(*) FILTER (WHERE asl.status = 'synced' AND asl.record_type IN ('payout', 'commission')) AS payouts_synced,
MAX(asl.synced_at) FILTER (WHERE asl.status = 'synced') AS last_sync_at
FROM accounting_sync_log asl
GROUP BY asl.provider;
END;
$$;

-- get_agency_financial_summary
CREATE OR REPLACE FUNCTION public.get_agency_financial_summary(agency_uuid uuid)
RETURNS TABLE(total_bookings bigint, total_revenue numeric, total_commissions numeric, net_earnings numeric, pending_payouts numeric)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
COUNT(cr.id) as total_bookings,
SUM(cr.total_tour_price) as total_revenue,
SUM(cr.agency_commission_amount) as total_commissions,
SUM(cr.agency_net_amount) as net_earnings,
SUM(CASE WHEN cr.status = 'pending' THEN cr.agency_net_amount ELSE 0 END) as pending_payouts
FROM commission_records cr
WHERE cr.agency_id = agency_uuid;
END;
$$;

-- get_agency_owner_id
CREATE OR REPLACE FUNCTION public.get_agency_owner_id(p_agency_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id
  FROM agencies
  WHERE id = p_agency_id;
  RETURN owner_id;
END;
$$;

-- get_agency_penalty_summary
CREATE OR REPLACE FUNCTION public.get_agency_penalty_summary(p_agency_id uuid)
RETURNS TABLE(total_pending numeric, total_processed numeric, pending_count bigint, processed_count bigint)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
COALESCE(SUM(CASE WHEN cpr.status = 'pending' THEN cpr.agency_net_amount ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN cpr.status = 'processed' THEN cpr.agency_net_amount ELSE 0 END), 0),
COUNT(CASE WHEN cpr.status = 'pending' THEN 1 END),
COUNT(CASE WHEN cpr.status = 'processed' THEN 1 END)
FROM cancellation_penalty_records cpr
WHERE cpr.agency_id = p_agency_id;
END;
$$;

-- get_agency_request_ids
CREATE OR REPLACE FUNCTION public.get_agency_request_ids(p_user_id uuid)
RETURNS TABLE(request_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
SELECT srq.id
FROM slot_reschedule_requests srq
JOIN agencies a ON a.id = srq.agency_id
WHERE a.user_id = p_user_id;
$$;

-- get_agency_tours
CREATE OR REPLACE FUNCTION public.get_agency_tours(p_agency_id uuid)
RETURNS TABLE(id uuid, name text, destination text, price numeric, start_date date, end_date date, image_url text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
t.id, t.name, t.destination, t.price, t.start_date, t.end_date, t.image_url
FROM public.tours t
WHERE t.agency_id = p_agency_id
AND t.end_date >= CURRENT_DATE
ORDER BY t.start_date ASC;
END;
$$;

-- get_alternative_slots_for_reschedule
CREATE OR REPLACE FUNCTION public.get_alternative_slots_for_reschedule(p_tour_id uuid, p_original_slot_id uuid, p_travelers_needed integer)
RETURNS TABLE(slot_id uuid, slot_date date, departure_time time, capacity integer, booked_count integer, available_spots integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
ts.id, ts.slot_date, ts.departure_time, ts.capacity, ts.booked_count,
(ts.capacity - ts.booked_count) AS available_spots
FROM tour_slots ts
WHERE ts.tour_id = p_tour_id
AND ts.id != p_original_slot_id
AND ts.status = 'activo'
AND ts.slot_date >= CURRENT_DATE
AND (ts.capacity - ts.booked_count) >= p_travelers_needed
ORDER BY ts.slot_date ASC, ts.departure_time ASC;
END;
$$;

-- get_balance_sheet
CREATE OR REPLACE FUNCTION public.get_balance_sheet(p_year integer, p_month integer)
RETURNS TABLE(code text, name text, account_type text, nature text, balance numeric)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    coa.code, coa.name, coa.account_type, coa.nature,
    CASE
      WHEN coa.nature = 'deudora' THEN
        COALESCE(SUM(ael.debit), 0) - COALESCE(SUM(ael.credit), 0)
      ELSE
        COALESCE(SUM(ael.credit), 0) - COALESCE(SUM(ael.debit), 0)
    END AS balance
  FROM chart_of_accounts coa
  LEFT JOIN accounting_entry_lines ael ON ael.account_code = coa.code
  LEFT JOIN accounting_entries ae ON ae.id = ael.entry_id
    AND ae.is_posted = true
    AND (
      ae.period_year < p_year
      OR (ae.period_year = p_year AND ae.period_month <= p_month)
    )
  WHERE coa.account_type IN ('activo', 'pasivo', 'capital')
    AND coa.is_active = true
  GROUP BY coa.code, coa.name, coa.account_type, coa.nature
  HAVING ABS(
    CASE
      WHEN coa.nature = 'deudora' THEN
        COALESCE(SUM(ael.debit), 0) - COALESCE(SUM(ael.credit), 0)
      ELSE
        COALESCE(SUM(ael.credit), 0) - COALESCE(SUM(ael.debit), 0)
    END
  ) > 0
  ORDER BY coa.code;
END;
$$;

-- get_booking_payment_details
CREATE OR REPLACE FUNCTION public.get_booking_payment_details(p_booking_id uuid)
RETURNS TABLE(booking_id uuid, total_price numeric, deposit_amount numeric, service_charge numeric, user_payment numeric, payment_status text, payment_method text, paid_at timestamptz, agency_commission numeric, agency_net_amount numeric)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_booking_user_id uuid;
  v_agency_user_id uuid;
  v_user_role text;
BEGIN
  v_user_id := auth.uid();
  SELECT role INTO v_user_role FROM users WHERE id = v_user_id;
  SELECT b.user_id INTO v_booking_user_id FROM bookings b WHERE b.id = p_booking_id;
  SELECT agencies.user_id INTO v_agency_user_id
  FROM bookings JOIN agencies ON bookings.agency_id = agencies.id
  WHERE bookings.id = p_booking_id;

  IF v_user_id != v_booking_user_id AND v_user_id != v_agency_user_id AND v_user_role != 'admin' THEN
    RAISE EXCEPTION 'No tienes permiso para ver los detalles de esta reserva';
  END IF;

  RETURN QUERY
  SELECT
    b.id, b.total_price, b.deposit_amount, b.service_charge, b.user_payment,
    b.payment_status, b.payment_method, b.paid_at, b.commission_amount,
    COALESCE(cr.agency_net_amount, b.deposit_amount - b.commission_amount)
  FROM bookings b
  LEFT JOIN commission_records cr ON b.id = cr.booking_id
  WHERE b.id = p_booking_id;
END;
$$;

-- get_cfdi_stats
CREATE OR REPLACE FUNCTION public.get_cfdi_stats()
RETURNS TABLE(total_stamped bigint, total_pending bigint, total_errors bigint, total_cancelled bigint, total_amount numeric)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
COUNT(*) FILTER (WHERE status = 'stamped'),
COUNT(*) FILTER (WHERE status = 'pending'),
COUNT(*) FILTER (WHERE status = 'error'),
COUNT(*) FILTER (WHERE status = 'cancelled'),
COALESCE(SUM(total) FILTER (WHERE status = 'stamped'), 0)
FROM cfdi_invoices;
END;
$$;

-- get_confirmed_spots_in_reschedule
CREATE OR REPLACE FUNCTION public.get_confirmed_spots_in_reschedule(p_request_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_confirmed_travelers integer;
BEGIN
SELECT COALESCE(SUM(b.travelers_count), 0)
INTO v_confirmed_travelers
FROM slot_reschedule_responses srr
JOIN bookings b ON b.id = srr.booking_id
WHERE srr.request_id = p_request_id
AND srr.confirmed_spot = true
AND b.status IN ('confirmed', 'pending');
RETURN v_confirmed_travelers;
END;
$$;

-- get_conversation_messages
CREATE OR REPLACE FUNCTION public.get_conversation_messages(p_conversation_id uuid)
RETURNS TABLE(id uuid, conversation_id uuid, sender_id uuid, content text, created_at timestamptz, sender_first_name text, sender_last_name text, sender_email text, sender_role text, sender_profile_picture text, agency_name text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_user_role text;
v_is_admin boolean;
v_is_participant boolean;
BEGIN
SELECT u.role, (u.role = 'admin') INTO v_user_role, v_is_admin
FROM users u WHERE u.id = auth.uid();

SELECT EXISTS (
SELECT 1 FROM message_participants mp
WHERE mp.conversation_id = p_conversation_id AND mp.user_id = auth.uid()
) INTO v_is_participant;

IF NOT v_is_admin AND NOT v_is_participant THEN
RAISE EXCEPTION 'No tienes acceso a esta conversación';
END IF;

RETURN QUERY
SELECT
m.id, m.conversation_id, m.sender_id, m.content, m.created_at,
u.first_name, u.last_name, u.email, u.role, u.profile_picture_url,
a.name
FROM messages m
JOIN users u ON m.sender_id = u.id
LEFT JOIN agencies a ON u.id = a.user_id AND u.role = 'agency'
WHERE m.conversation_id = p_conversation_id
ORDER BY m.created_at ASC;
END;
$$;

-- get_discount_code_details
CREATE OR REPLACE FUNCTION public.get_discount_code_details(p_code_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_code_record record;
v_usage_records jsonb;
BEGIN
SELECT * INTO v_code_record FROM public.discount_codes WHERE id = p_code_id;
IF v_code_record IS NULL THEN
RETURN jsonb_build_object('error', 'Código no encontrado');
END IF;

SELECT jsonb_agg(
jsonb_build_object(
'id', dcu.id, 'user_id', dcu.user_id,
'user_name', u.first_name || ' ' || u.last_name,
'used_at', dcu.used_at, 'booking_id', dcu.booking_id,
'gift_card_id', dcu.gift_card_id, 'membership_id', dcu.membership_id
) ORDER BY dcu.used_at DESC
)
INTO v_usage_records
FROM public.discount_code_usage dcu
LEFT JOIN public.users u ON u.id = dcu.user_id
WHERE dcu.discount_code_id = p_code_id;

RETURN jsonb_build_object(
'id', v_code_record.id, 'code', v_code_record.code,
'description', v_code_record.description,
'discount_type', v_code_record.discount_type,
'discount_value', v_code_record.discount_value,
'applicable_to', v_code_record.applicable_to,
'is_single_use', v_code_record.is_single_use,
'is_active', v_code_record.is_active,
'valid_from', v_code_record.valid_from,
'valid_until', v_code_record.valid_until,
'max_uses', v_code_record.max_uses,
'times_used', v_code_record.times_used,
'created_at', v_code_record.created_at,
'usage_records', COALESCE(v_usage_records, '[]'::jsonb)
);
END;
$$;

-- get_income_statement
CREATE OR REPLACE FUNCTION public.get_income_statement(p_from_year integer, p_from_month integer, p_to_year integer, p_to_month integer)
RETURNS TABLE(code text, name text, account_type text, total_amount numeric)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    coa.code, coa.name, coa.account_type,
    CASE
      WHEN coa.nature = 'acreedora' THEN
        COALESCE(SUM(ael.credit), 0) - COALESCE(SUM(ael.debit), 0)
      ELSE
        COALESCE(SUM(ael.debit), 0) - COALESCE(SUM(ael.credit), 0)
    END AS total_amount
  FROM chart_of_accounts coa
  LEFT JOIN accounting_entry_lines ael ON ael.account_code = coa.code
  LEFT JOIN accounting_entries ae ON ae.id = ael.entry_id
    AND ae.is_posted = true
    AND (ae.period_year > p_from_year OR (ae.period_year = p_from_year AND ae.period_month >= p_from_month))
    AND (ae.period_year < p_to_year OR (ae.period_year = p_to_year AND ae.period_month <= p_to_month))
  WHERE coa.account_type IN ('ingreso', 'gasto', 'costo') AND coa.is_active = true
  GROUP BY coa.code, coa.name, coa.account_type, coa.nature
  HAVING (COALESCE(SUM(ael.debit), 0) > 0 OR COALESCE(SUM(ael.credit), 0) > 0)
  ORDER BY coa.code;
END;
$$;

-- get_next_available_slot
CREATE OR REPLACE FUNCTION public.get_next_available_slot(p_tour_id uuid)
RETURNS TABLE(slot_id uuid, slot_date date, departure_time time, available_count integer, capacity integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
ts.id, ts.slot_date, ts.departure_time,
GREATEST(0, ts.capacity - ts.booked_count), ts.capacity
FROM public.tour_slots ts
WHERE ts.tour_id = p_tour_id
AND ts.status = 'activo'
AND ts.slot_date >= CURRENT_DATE
AND ts.booked_count < ts.capacity
ORDER BY ts.slot_date ASC, ts.departure_time ASC
LIMIT 1;
END;
$$;

-- get_pending_reschedule_for_booking
CREATE OR REPLACE FUNCTION public.get_pending_reschedule_for_booking(p_booking_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_result JSON;
BEGIN
SELECT json_build_object(
'reschedule', json_build_object(
'id', tr.id, 'tour_id', tr.tour_id, 'tour_name', t.name,
'original_start_date', tr.original_start_date, 'original_end_date', tr.original_end_date,
'new_start_date', tr.new_start_date, 'new_end_date', tr.new_end_date,
'reason', tr.reason, 'response_deadline', tr.response_deadline, 'created_at', tr.created_at
),
'response', json_build_object(
'id', brr.id, 'response', brr.response, 'responded_at', brr.responded_at,
'notification_sent', brr.notification_sent, 'email_sent', brr.email_sent
)
) INTO v_result
FROM booking_reschedule_responses brr
INNER JOIN tour_reschedules tr ON brr.tour_reschedule_id = tr.id
INNER JOIN tours t ON tr.tour_id = t.id
WHERE brr.booking_id = p_booking_id
AND brr.response = 'pending'
AND tr.status = 'pending_responses'
AND tr.response_deadline > now()
ORDER BY tr.created_at DESC
LIMIT 1;
RETURN v_result;
END;
$$;

-- get_reschedule_summary_for_tour
CREATE OR REPLACE FUNCTION public.get_reschedule_summary_for_tour(p_tour_reschedule_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_result JSON;
BEGIN
SELECT json_build_object(
'total', COUNT(*),
'pending', COUNT(*) FILTER (WHERE response = 'pending'),
'accepted', COUNT(*) FILTER (WHERE response = 'accepted'),
'rejected', COUNT(*) FILTER (WHERE response = 'rejected'),
'auto_accepted', COUNT(*) FILTER (WHERE response = 'auto_accepted'),
'responses', json_agg(
json_build_object(
'booking_id', brr.booking_id, 'booking_code', b.booking_code,
'user_name', u.first_name || ' ' || u.last_name,
'user_email', u.email, 'response', brr.response, 'responded_at', brr.responded_at
) ORDER BY brr.created_at
)
) INTO v_result
FROM booking_reschedule_responses brr
INNER JOIN bookings b ON brr.booking_id = b.id
INNER JOIN users u ON brr.user_id = u.id
WHERE brr.tour_reschedule_id = p_tour_reschedule_id;
RETURN v_result;
END;
$$;

-- get_staff_with_permissions
CREATE OR REPLACE FUNCTION public.get_staff_with_permissions(p_user_id uuid)
RETURNS TABLE(staff_id uuid, agency_id uuid, agency_name text, title text, is_active boolean, can_scan_checkin boolean, can_view_bookings boolean, can_view_tours boolean, can_edit_tours boolean, can_manage_tours boolean, can_view_financials boolean, can_view_reports boolean, can_manage_discount_codes boolean, can_view_messages boolean, can_manage_destinations boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
SELECT
s.id, s.agency_id, a.name, s.title, s.is_active,
COALESCE(p.can_scan_checkin, false),
COALESCE(p.can_view_bookings, false),
COALESCE(p.can_view_tours, false),
COALESCE(p.can_edit_tours, false),
COALESCE(p.can_manage_tours, false),
COALESCE(p.can_view_financials, false),
COALESCE(p.can_view_reports, false),
COALESCE(p.can_manage_discount_codes, false),
COALESCE(p.can_view_messages, false),
COALESCE(p.can_manage_destinations, false)
FROM agency_staff s
JOIN agencies a ON a.id = s.agency_id
LEFT JOIN agency_staff_permissions p ON p.staff_id = s.id
WHERE s.user_id = p_user_id AND s.is_active = true
ORDER BY s.linked_at ASC;
$$;

-- get_tour_confirmed_attendees
CREATE OR REPLACE FUNCTION public.get_tour_confirmed_attendees(p_tour_id uuid, p_slot_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(booking_id uuid, user_id uuid, email text, first_name text, last_name text, travelers_count integer, selected_date date, selected_time time, booking_code varchar)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
b.id, b.user_id, u.email, u.first_name, u.last_name,
b.travelers_count, b.selected_date, b.selected_time, b.booking_code
FROM bookings b
JOIN users u ON u.id = b.user_id
WHERE b.tour_id = p_tour_id
AND b.status = 'confirmed'
AND (p_slot_id IS NULL OR b.slot_id = p_slot_id);
END;
$$;

-- get_tour_slots_by_range
CREATE OR REPLACE FUNCTION public.get_tour_slots_by_range(p_tour_id uuid, p_start_date date, p_end_date date)
RETURNS TABLE(id uuid, tour_id uuid, agency_id uuid, schedule_id uuid, slot_date date, departure_time time, end_date date, capacity integer, booked_count integer, available_count integer, status slot_status_enum, is_auto_generated boolean, min_travelers_reached boolean, notes text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
ts.id, ts.tour_id, ts.agency_id, ts.schedule_id, ts.slot_date, ts.departure_time,
ts.end_date, ts.capacity, ts.booked_count,
GREATEST(0, ts.capacity - ts.booked_count),
ts.status, ts.is_auto_generated, ts.min_travelers_reached, ts.notes, ts.created_at
FROM public.tour_slots ts
WHERE ts.tour_id = p_tour_id
AND ts.slot_date >= p_start_date
AND ts.slot_date <= p_end_date
AND ts.status != 'cancelado'
AND NOT EXISTS (
SELECT 1 FROM public.tour_slot_blackouts b
WHERE b.tour_id = p_tour_id
AND ts.slot_date >= b.blackout_start::date
AND ts.slot_date <= b.blackout_end::date
)
ORDER BY ts.slot_date ASC, ts.departure_time ASC;
END;
$$;

-- get_trial_balance
CREATE OR REPLACE FUNCTION public.get_trial_balance(p_year integer, p_month integer)
RETURNS TABLE(code text, name text, sat_group_code text, account_type text, nature text, opening_debit numeric, opening_credit numeric, period_debit numeric, period_credit numeric, closing_debit numeric, closing_credit numeric)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
WITH period_movements AS (
SELECT ael.account_code, SUM(ael.debit) AS period_debit, SUM(ael.credit) AS period_credit
FROM accounting_entry_lines ael
JOIN accounting_entries ae ON ae.id = ael.entry_id
WHERE ae.period_year = p_year AND ae.period_month = p_month AND ae.is_posted = true
GROUP BY ael.account_code
),
prior_movements AS (
SELECT ael.account_code, SUM(ael.debit) AS prior_debit, SUM(ael.credit) AS prior_credit
FROM accounting_entry_lines ael
JOIN accounting_entries ae ON ae.id = ael.entry_id
WHERE (ae.period_year < p_year OR (ae.period_year = p_year AND ae.period_month < p_month))
AND ae.is_posted = true
GROUP BY ael.account_code
)
SELECT
coa.code, coa.name, coa.sat_group_code, coa.account_type, coa.nature,
COALESCE(pm_prior.prior_debit, 0), COALESCE(pm_prior.prior_credit, 0),
COALESCE(pm.period_debit, 0), COALESCE(pm.period_credit, 0),
COALESCE(pm_prior.prior_debit, 0) + COALESCE(pm.period_debit, 0),
COALESCE(pm_prior.prior_credit, 0) + COALESCE(pm.period_credit, 0)
FROM chart_of_accounts coa
LEFT JOIN period_movements pm ON pm.account_code = coa.code
LEFT JOIN prior_movements pm_prior ON pm_prior.account_code = coa.code
WHERE coa.is_active = true AND coa.level >= 3
AND (
COALESCE(pm.period_debit, 0) > 0 OR COALESCE(pm.period_credit, 0) > 0
OR COALESCE(pm_prior.prior_debit, 0) > 0 OR COALESCE(pm_prior.prior_credit, 0) > 0
)
ORDER BY coa.code;
END;
$$;

-- get_unread_notifications_count (no-arg version)
CREATE OR REPLACE FUNCTION public.get_unread_notifications_count()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    unread_count integer;
BEGIN
    IF auth.uid() IS NULL THEN RETURN 0; END IF;
    SELECT COUNT(*) INTO unread_count
    FROM public.notifications
    WHERE user_id = auth.uid()
      AND is_read = FALSE
      AND (expires_at IS NULL OR expires_at > NOW());
    RETURN COALESCE(unread_count, 0);
END;
$$;

-- get_unread_notifications_count (p_user_id version)
CREATE OR REPLACE FUNCTION public.get_unread_notifications_count(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  unread_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO unread_count
  FROM notifications
  WHERE user_id = p_user_id
    AND is_read = false
    AND (expires_at IS NULL OR expires_at > now());
  RETURN unread_count;
END;
$$;

-- get_user_conversations
CREATE OR REPLACE FUNCTION public.get_user_conversations()
RETURNS TABLE(conversation_id uuid, title text, type text, status text, booking_id uuid, tour_id uuid, tour_title text, unread_count bigint, last_message_content text, last_message_at timestamptz, last_message_sender text, participant_count bigint, other_participant_id uuid, other_participant_name text, other_participant_email text, other_participant_role text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY SELECT * FROM _get_user_conversations_internal(auth.uid());
END;
$$;

-- get_user_notifications
CREATE OR REPLACE FUNCTION public.get_user_notifications(limit_count integer DEFAULT 10, offset_count integer DEFAULT 0, include_read boolean DEFAULT true)
RETURNS TABLE(id uuid, user_id uuid, type notification_type, title text, message text, data jsonb, is_read boolean, created_at timestamptz, updated_at timestamptz, expires_at timestamptz, is_expired boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT
        n.id, n.user_id, n.type, n.title, n.message, n.data, n.is_read,
        n.created_at, n.updated_at, n.expires_at,
        CASE WHEN n.expires_at IS NOT NULL AND n.expires_at <= NOW() THEN true ELSE false END
    FROM public.notifications n
    WHERE n.user_id = auth.uid()
      AND (include_read = true OR n.is_read = false)
      AND (n.expires_at IS NULL OR n.expires_at > NOW())
    ORDER BY n.created_at DESC
    LIMIT limit_count OFFSET offset_count;
END;
$$;

-- is_tour_ready_for_payout
CREATE OR REPLACE FUNCTION public.is_tour_ready_for_payout(p_tour_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_end_date date;
BEGIN
SELECT end_date INTO v_end_date FROM tours WHERE id = p_tour_id;
IF NOT FOUND THEN RETURN false; END IF;
RETURN (CURRENT_DATE - v_end_date) >= 3;
END;
$$;

-- mark_all_notifications_as_read
CREATE OR REPLACE FUNCTION public.mark_all_notifications_as_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    updated_count integer;
BEGIN
    IF auth.uid() IS NULL THEN RETURN 0; END IF;
    UPDATE public.notifications
    SET is_read = true, updated_at = NOW()
    WHERE user_id = auth.uid()
      AND is_read = false
      AND (expires_at IS NULL OR expires_at > NOW());
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$;

-- mark_conversation_read
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
UPDATE message_participants
SET last_read_at = NOW()
WHERE conversation_id = p_conversation_id
AND user_id = auth.uid();
END;
$$;

-- mark_messages_as_read
CREATE OR REPLACE FUNCTION public.mark_messages_as_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
UPDATE public.message_participants
SET last_read_at = now()
WHERE conversation_id = p_conversation_id
AND user_id = auth.uid();
END;
$$;

-- mark_notification_as_read
CREATE OR REPLACE FUNCTION public.mark_notification_as_read(notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    updated_count integer;
BEGIN
    IF auth.uid() IS NULL THEN RETURN false; END IF;
    UPDATE public.notifications
    SET is_read = true, updated_at = NOW()
    WHERE id = notification_id
      AND user_id = auth.uid()
      AND is_read = false;
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count > 0;
END;
$$;

-- mark_notifications_as_read
CREATE OR REPLACE FUNCTION public.mark_notifications_as_read(notification_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE notifications
  SET is_read = true, updated_at = now()
  WHERE id = ANY(notification_ids)
    AND user_id = auth.uid();
END;
$$;

-- Restore EXECUTE grants for authenticated role on all converted functions
GRANT EXECUTE ON FUNCTION public._get_user_conversations_internal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_balances_full(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_accounting_sync_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agency_financial_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agency_owner_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agency_penalty_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agency_request_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_agency_tours(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_alternative_slots_for_reschedule(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_balance_sheet(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_booking_payment_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cfdi_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_confirmed_spots_in_reschedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_messages(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_discount_code_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_income_statement(integer, integer, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_available_slot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_reschedule_for_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_reschedule_summary_for_tour(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_staff_with_permissions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tour_confirmed_attendees(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tour_slots_by_range(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trial_balance(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_notifications_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_notifications_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_notifications(integer, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tour_ready_for_payout(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_as_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_messages_as_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_as_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notifications_as_read(uuid[]) TO authenticated;
