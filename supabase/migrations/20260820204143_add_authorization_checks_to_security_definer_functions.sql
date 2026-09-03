-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260820204143
--   name:    add_authorization_checks_to_security_definer_functions
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

/*
# Add Authorization Checks to 10 SECURITY DEFINER Functions + Fix Featured Slot Payment Bug

## Summary

This migration adds authorization checks to 10 existing SECURITY DEFINER functions that
were callable by any authenticated user without verifying ownership or role. It also fixes
a critical bug in `activate_featured_slot` where the slot was immediately set to 'active'
with an expiration date BEFORE any payment was made.

## Changes

### 1. activate_featured_slot — Bug fix + authorization
- **Bug fix**: Changed `status` from `'active'` to `'pending_payment'` and removed the
  `expires_at` calculation from the INSERT. The slot now starts in `pending_payment` state
  and `confirm_featured_slot_payment` (called by the payment webhook) is responsible for
  setting it to `'active'` and calculating `expires_at`.
- **Authorization**: Verifies that `p_agency_id` belongs to `auth.uid()` via
  `agencies.user_id` or that the user is admin.
- The `expires_at` column is NOT NULL, so we insert a placeholder (now() + plan duration)
  that will be overwritten by `confirm_featured_slot_payment`. The `starts_at` is set to now()
  as a placeholder. Both are corrected by the confirmation function.

### 2. get_balance_sheet — Authorization
- Only admin or accountant users can execute.

### 3. insert_audit_log — Authorization
- If `auth.uid()` is NULL (service role / edge function call), allow without check.
- If `auth.uid()` is NOT NULL, must be admin.

### 4. get_agency_staff_for_owner — Authorization
- Verifies that `p_agency_id` belongs to `auth.uid()` via `agencies.user_id` or admin.

### 5. create_accounting_entry_for_executive_commission — Authorization
- Only admin can execute.

### 6. activate_draft_booking — Authorization
- Verifies that the booking belongs to `auth.uid()` via `bookings.user_id`.
- No guest bookings exist (user_id is NOT NULL with 0 null values confirmed).

### 7. auto_generate_slots_for_range — Authorization
- Verifies that the tour belongs to an agency owned by `auth.uid()` or admin.

### 8. reserve_seats — Authorization
- Verifies that the booking belongs to `auth.uid()` via `bookings.user_id`.

### 9. create_commission_records_for_receptivo_slot — Authorization
- Only admin can execute.

### 10. create_commission_records_for_tour — Authorization
- Only admin can execute.

## Security Impact
All 10 functions now have proper authorization checks at the top of their body,
preventing unauthorized access by non-owner or non-admin authenticated users.
*/

-- ============================================================
-- 1. activate_featured_slot (bug fix + authorization)
-- ============================================================
CREATE OR REPLACE FUNCTION public.activate_featured_slot(p_tour_id uuid, p_agency_id uuid, p_plan_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_active_count  int;
v_slot_id       uuid;
v_plan          RECORD;
v_existing_slot uuid;
v_is_owner      boolean;
v_is_admin      boolean;
BEGIN
-- Authorization: agency must belong to the authenticated user or user must be admin
SELECT EXISTS(SELECT 1 FROM agencies WHERE id = p_agency_id AND user_id = auth.uid())
INTO v_is_owner;
v_is_admin := public.is_admin_user();
IF NOT v_is_owner AND NOT v_is_admin THEN
RAISE EXCEPTION 'No autorizado';
END IF;

-- Advisory lock prevents concurrent activations from exceeding the cap
PERFORM pg_advisory_xact_lock(hashtext('featured_slots'::text));

-- Global cap on active slots
SELECT COUNT(*) INTO v_active_count
FROM public.featured_tour_slots
WHERE status = 'active' AND expires_at > now();

IF v_active_count >= 50 THEN
RAISE EXCEPTION 'Maximum of 50 active featured slots reached';
END IF;

-- No active slot for this tour
SELECT id INTO v_existing_slot
FROM public.featured_tour_slots
WHERE tour_id = p_tour_id AND status = 'active' AND expires_at > now()
FOR UPDATE;

IF v_existing_slot IS NOT NULL THEN
RAISE EXCEPTION 'Tour already has an active featured slot';
END IF;

-- Get plan details
SELECT * INTO v_plan FROM public.featured_tour_plans WHERE id = p_plan_id AND is_active = true;
IF NOT FOUND THEN
RAISE EXCEPTION 'Plan not found or inactive';
END IF;

-- Insert the new slot in pending_payment status (no expires_at yet —
-- confirm_featured_slot_payment will set it to 'active' with the real expires_at)
INSERT INTO public.featured_tour_slots (
tour_id, agency_id, plan_id, status, starts_at, expires_at, total_amount
) VALUES (
p_tour_id, p_agency_id, p_plan_id, 'pending_payment', now(),
-- Placeholder expires_at (NOT NULL constraint); will be overwritten by confirm_featured_slot_payment
now() + (v_plan.duration_days || ' days')::interval,
v_plan.price
)
RETURNING id INTO v_slot_id;

RETURN v_slot_id;
END;
$function$;

-- ============================================================
-- 2. get_balance_sheet (authorization: admin or accountant)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_balance_sheet(p_year integer, p_month integer)
RETURNS TABLE(code text, name text, account_type text, nature text, balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
-- Authorization: only admin or accountant
IF NOT public.is_admin_user() AND NOT public.is_accountant_user() THEN
RAISE EXCEPTION 'Acceso no autorizado';
END IF;

RETURN QUERY
SELECT
coa.code,
coa.name,
coa.account_type,
coa.nature,
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
WHERE coa.account_type IN ('activo', 'pasivo', 'capital', 'ingreso', 'gasto', 'costo')
AND coa.is_active = true
AND coa.level >= 3
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
$function$;

-- ============================================================
-- 3. insert_audit_log (authorization: service role allowed, user must be admin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.insert_audit_log(
p_tenant_type text,
p_actor_id uuid DEFAULT NULL::uuid,
p_actor_email text DEFAULT NULL::text,
p_actor_role text DEFAULT NULL::text,
p_target_id text DEFAULT NULL::text,
p_target_table text DEFAULT NULL::text,
p_action text DEFAULT NULL::text,
p_old_values jsonb DEFAULT NULL::jsonb,
p_new_values jsonb DEFAULT NULL::jsonb,
p_ip_address inet DEFAULT NULL::inet,
p_ip_masked text DEFAULT NULL::text,
p_user_agent text DEFAULT NULL::text,
p_session_id text DEFAULT NULL::text,
p_correlation_id uuid DEFAULT NULL::uuid,
p_metadata jsonb DEFAULT NULL::jsonb,
p_error_message text DEFAULT NULL::text,
p_created_at timestamp with time zone DEFAULT now(),
p_country text DEFAULT NULL::text,
p_country_code text DEFAULT NULL::text,
p_city text DEFAULT NULL::text,
p_region text DEFAULT NULL::text,
p_severity text DEFAULT 'info'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_id        uuid := gen_random_uuid();
v_diff      jsonb;
v_tenant    tenant_type;
v_severity  text;
v_sqlerrm   text;
v_sqlstate  text;
BEGIN
-- Authorization: if auth.uid() is NULL (service role / edge function), allow.
-- If auth.uid() is NOT NULL (authenticated user), must be admin.
IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
RAISE EXCEPTION 'Acceso no autorizado';
END IF;

-- Cast tenant_type safely
BEGIN
v_tenant := p_tenant_type::tenant_type;
EXCEPTION WHEN invalid_text_representation THEN
v_tenant := 'system'::tenant_type;
END;

-- Validate severity
v_severity := CASE WHEN p_severity IN ('info', 'warning', 'critical') THEN p_severity ELSE 'info' END;

-- Compute diff
IF p_old_values IS NOT NULL AND p_new_values IS NOT NULL THEN
SELECT jsonb_object_agg(n.key, n.value)
INTO v_diff
FROM jsonb_each(p_new_values) n
WHERE NOT (p_old_values @> jsonb_build_object(n.key, n.value));
END IF;

INSERT INTO audit_logs (
id, tenant_type, actor_id, actor_email, actor_role,
target_id, target_table, action,
old_values, new_values, diff,
ip_address, ip_masked, user_agent, session_id,
correlation_id, metadata, error_message, created_at,
country, country_code, city, region, severity
) VALUES (
v_id, v_tenant, p_actor_id, p_actor_email, p_actor_role,
p_target_id, p_target_table, p_action,
p_old_values, p_new_values, v_diff,
p_ip_address, p_ip_masked, p_user_agent, p_session_id,
p_correlation_id, p_metadata, p_error_message, p_created_at,
p_country, p_country_code, p_city, p_region, v_severity
);

RETURN v_id;

EXCEPTION WHEN OTHERS THEN
GET STACKED DIAGNOSTICS v_sqlerrm = MESSAGE_TEXT, v_sqlstate = RETURNED_SQLSTATE;

RAISE WARNING 'insert_audit_log failed [%]: % | action=% table=% actor=%',
v_sqlstate, v_sqlerrm, p_action, p_target_table, p_actor_id;

BEGIN
INSERT INTO audit_errors (error_message, sqlstate, raw_payload)
VALUES (
v_sqlerrm,
v_sqlstate,
jsonb_build_object(
'action',       p_action,
'target_table', p_target_table,
'actor_id',     p_actor_id,
'actor_email',  p_actor_email,
'tenant_type',  p_tenant_type
)
);
EXCEPTION WHEN OTHERS THEN
NULL;
END;

RETURN NULL;
END;
$function$;

-- ============================================================
-- 4. get_agency_staff_for_owner (authorization: owner or admin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_agency_staff_for_owner(p_agency_id uuid)
RETURNS TABLE(
staff_id uuid, user_id uuid, title text, is_active boolean,
linked_at timestamp with time zone, unlinked_at timestamp with time zone,
first_name text, last_name text, email text, profile_picture_url text,
perm_id uuid, can_scan_checkin boolean, can_view_bookings boolean,
can_view_tours boolean, can_edit_tours boolean, can_manage_tours boolean,
can_view_financials boolean, can_view_reports boolean,
can_manage_discount_codes boolean, can_view_messages boolean,
can_manage_destinations boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
SELECT
s.id,
s.user_id,
s.title,
s.is_active,
s.linked_at,
s.unlinked_at,
u.first_name,
u.last_name,
u.email,
u.profile_picture_url,
p.id AS perm_id,
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
JOIN users u ON u.id = s.user_id
LEFT JOIN agency_staff_permissions p ON p.staff_id = s.id
WHERE s.agency_id = p_agency_id
-- Authorization: agency must belong to the authenticated user or user must be admin
AND (
EXISTS (SELECT 1 FROM agencies WHERE id = p_agency_id AND user_id = auth.uid())
OR public.is_admin_user()
)
ORDER BY s.linked_at DESC;
$function$;

-- ============================================================
-- 5. create_accounting_entry_for_executive_commission (authorization: admin only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_accounting_entry_for_executive_commission(p_commission_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_commission record;
v_entry_id uuid;
v_entry_number text;
v_year integer;
v_month integer;
v_amount numeric;
v_exec_name text;
BEGIN
-- Authorization: only admin
IF NOT public.is_admin_user() THEN
RAISE EXCEPTION 'Acceso no autorizado';
END IF;

IF EXISTS (
SELECT 1 FROM accounting_entries
WHERE source_type = 'executive_commission' AND source_id = p_commission_id
) THEN
RETURN NULL;
END IF;

SELECT ec.*, ae.first_name, ae.last_name
INTO v_commission
FROM executive_commissions ec
LEFT JOIN account_executives ae ON ae.id = ec.executive_id
WHERE ec.id = p_commission_id AND ec.status = 'paid';

IF NOT FOUND THEN
RETURN NULL;
END IF;

v_amount := COALESCE(v_commission.amount, 0);
IF v_amount = 0 THEN
RETURN NULL;
END IF;

v_exec_name := COALESCE(v_commission.first_name, '') || ' ' || COALESCE(v_commission.last_name, '');
v_year := EXTRACT(YEAR FROM COALESCE(v_commission.paid_at, CURRENT_DATE))::integer;
v_month := EXTRACT(MONTH FROM COALESCE(v_commission.paid_at, CURRENT_DATE))::integer;

v_entry_number := generate_entry_number('egreso', v_year, v_month);

INSERT INTO accounting_entries (
entry_number, entry_type, entry_date, period_year, period_month,
description, source_type, source_id, is_posted
) VALUES (
v_entry_number,
'egreso',
COALESCE(v_commission.paid_at, CURRENT_DATE),
v_year,
v_month,
'Comision ejecutivo ' || trim(v_exec_name) || ' - ref: ' || COALESCE(v_commission.payment_reference, ''),
'executive_commission',
p_commission_id,
true
)
RETURNING id INTO v_entry_id;

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
VALUES (v_entry_id, 1, '601.05', 'Comision ejecutivo ' || trim(v_exec_name), v_amount, 0);

INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit)
VALUES (v_entry_id, 2, '102', 'Pago comision ejecutivo - ' || COALESCE(v_commission.payment_reference, ''), 0, v_amount);

RETURN v_entry_id;
END;
$function$;

-- ============================================================
-- 6. activate_draft_booking (authorization: booking owner only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.activate_draft_booking(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_booking record;
v_slot record;
v_max_capacity integer;
v_total_booked integer;
v_available integer;
BEGIN
-- Authorization: booking must belong to the authenticated user
SELECT b.id, b.status, b.tour_id, b.travelers_count, b.approval_status, b.slot_id, b.user_id
INTO v_booking
FROM bookings b
WHERE b.id = p_booking_id
FOR UPDATE;

IF v_booking IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Reserva no encontrada');
END IF;

IF v_booking.user_id != auth.uid() THEN
RAISE EXCEPTION 'No autorizado';
END IF;

IF v_booking.status != 'draft' THEN
RETURN jsonb_build_object('success', true, 'message', 'La reserva ya fue activada');
END IF;

IF v_booking.slot_id IS NOT NULL THEN
-- Tours with the slot system: validate against the specific slot's capacity
SELECT ts.capacity, ts.booked_count
INTO v_slot
FROM tour_slots ts
WHERE ts.id = v_booking.slot_id
FOR UPDATE;

IF v_slot IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'El slot seleccionado ya no existe');
END IF;

v_available := v_slot.capacity - v_slot.booked_count;
ELSE
-- Serialize concurrent activations for the same slot-less tour
PERFORM pg_advisory_xact_lock(hashtext(v_booking.tour_id::text));

-- Tours without the slot system: fallback to tour-wide capacity
SELECT
COALESCE(
CASE
WHEN t.available_spots IS NOT NULL AND t.available_spots > 0
THEN t.available_spots
ELSE COALESCE(t.max_travelers, 10)
END,
10
),
COALESCE(SUM(ob.travelers_count), 0)::integer
INTO v_max_capacity, v_total_booked
FROM tours t
LEFT JOIN bookings ob
ON ob.tour_id = t.id
AND ob.id != p_booking_id
AND (
ob.status = 'confirmed'
OR (ob.status = 'pending' AND ob.approval_status = 'approved')
)
WHERE t.id = v_booking.tour_id
GROUP BY t.id, t.available_spots, t.max_travelers;

v_available := v_max_capacity - v_total_booked;
END IF;

IF v_booking.travelers_count > v_available THEN
RETURN jsonb_build_object(
'success', false,
'error', 'No hay suficientes lugares disponibles',
'available_spots', v_available,
'requested', v_booking.travelers_count
);
END IF;

UPDATE bookings
SET status = 'pending',
updated_at = now()
WHERE id = p_booking_id;

RETURN jsonb_build_object('success', true, 'available_spots', v_available - v_booking.travelers_count);
END;
$function$;

-- ============================================================
-- 7. auto_generate_slots_for_range (authorization: agency owner or admin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_generate_slots_for_range(p_tour_id uuid, p_start_date date, p_end_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_schedule RECORD;
v_current_date date;
v_slot_exists boolean;
v_created_count int := 0;
v_tour RECORD;
v_is_owner boolean;
v_is_admin boolean;
BEGIN
-- Authorization: tour must belong to an agency owned by the authenticated user, or admin
SELECT EXISTS(
SELECT 1 FROM tours t
JOIN agencies a ON a.id = t.agency_id
WHERE t.id = p_tour_id AND a.user_id = auth.uid()
) INTO v_is_owner;
v_is_admin := public.is_admin_user();
IF NOT v_is_owner AND NOT v_is_admin THEN
RAISE EXCEPTION 'No autorizado';
END IF;

-- Advisory lock prevents concurrent slot generation for the same tour
PERFORM pg_advisory_xact_lock(hashtext(p_tour_id::text));

SELECT * INTO v_tour FROM public.tours WHERE id = p_tour_id;
IF NOT FOUND THEN
RAISE EXCEPTION 'Tour no encontrado';
END IF;

IF v_tour.tour_type <> 'receptivo' THEN
RAISE EXCEPTION 'Solo tours receptivos soportan generacion automatica de slots';
END IF;

FOR v_schedule IN
SELECT * FROM public.tour_schedules
WHERE tour_id = p_tour_id
AND is_active = true
LOOP
v_current_date := GREATEST(p_start_date, v_schedule.start_date);
IF v_schedule.end_date IS NOT NULL THEN
v_current_date := GREATEST(v_current_date, CURRENT_DATE);
END IF;

WHILE v_current_date <= p_end_date
AND (v_schedule.end_date IS NULL OR v_current_date <= v_schedule.end_date)
LOOP
-- Check if slot exists
SELECT EXISTS (
SELECT 1 FROM public.tour_slots ts
WHERE ts.tour_id = p_tour_id
AND ts.schedule_id = v_schedule.id
AND ts.slot_date = v_current_date
AND ts.status != 'cancelado'
) INTO v_slot_exists;

IF NOT v_slot_exists THEN
INSERT INTO public.tour_slots (
tour_id, schedule_id, slot_date, departure_time,
capacity, booked_count, status
) VALUES (
p_tour_id, v_schedule.id, v_current_date, v_schedule.departure_time,
v_schedule.capacity, 0, 'activo'
);
v_created_count := v_created_count + 1;
END IF;

v_current_date := v_current_date + INTERVAL '1 day';
END LOOP;
END LOOP;

RETURN v_created_count;
END;
$function$;

-- ============================================================
-- 8. reserve_seats (authorization: booking owner only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.reserve_seats(
p_tour_id uuid,
p_agency_id uuid,
p_booking_id uuid,
p_seat_numbers integer[],
p_slot_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_conflicting integer[];
v_seat integer;
v_reserved integer[] := '{}';
v_failed integer[] := '{}';
v_rows integer;
v_booking_user_id uuid;
BEGIN
-- Authorization: booking must belong to the authenticated user
SELECT b.user_id INTO v_booking_user_id
FROM bookings b
WHERE b.id = p_booking_id;

IF v_booking_user_id IS NULL THEN
RAISE EXCEPTION 'Reserva no encontrada';
END IF;

IF v_booking_user_id != auth.uid() THEN
RAISE EXCEPTION 'No autorizado';
END IF;

-- Verificar que todos los asientos esten disponibles (con bloqueo FOR UPDATE)
SELECT ARRAY_AGG(seat_number)
INTO v_conflicting
FROM slot_seat_status
WHERE tour_id = p_tour_id
AND (
(p_slot_id IS NULL AND slot_id IS NULL)
OR (p_slot_id IS NOT NULL AND slot_id = p_slot_id)
)
AND seat_number = ANY(p_seat_numbers)
AND status != 'disponible'
FOR UPDATE;

IF v_conflicting IS NOT NULL AND array_length(v_conflicting, 1) > 0 THEN
RETURN jsonb_build_object(
'success', false,
'error', 'Algunos asientos ya no estan disponibles',
'conflicting_seats', v_conflicting
);
END IF;

-- Insertar o actualizar estado de cada asiento
FOREACH v_seat IN ARRAY p_seat_numbers LOOP
INSERT INTO slot_seat_status (
tour_id, slot_id, agency_id, seat_number, status, booking_id
) VALUES (
p_tour_id, p_slot_id, p_agency_id, v_seat, 'reservado_online', p_booking_id
)
ON CONFLICT (tour_id, slot_id, seat_number)
DO UPDATE SET
status = 'reservado_online',
booking_id = p_booking_id,
updated_at = now()
WHERE slot_seat_status.booking_id = p_booking_id
OR slot_seat_status.status = 'disponible';

GET DIAGNOSTICS v_rows = ROW_COUNT;

IF v_rows = 0 THEN
v_failed := array_append(v_failed, v_seat);
ELSE
v_reserved := array_append(v_reserved, v_seat);
END IF;
END LOOP;

IF array_length(v_failed, 1) > 0 THEN
RETURN jsonb_build_object(
'success', false,
'error', 'Algunos asientos ya no estan disponibles',
'conflicting_seats', v_failed,
'reserved_seats', v_reserved
);
END IF;

RETURN jsonb_build_object(
'success', true,
'reserved_seats', p_seat_numbers
);
END;
$function$;

-- ============================================================
-- 9. create_commission_records_for_receptivo_slot (authorization: admin only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_commission_records_for_receptivo_slot(p_slot_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_slot_record    record;
v_booking_record record;
v_breakdown      record;
v_created_count  integer := 0;
v_skipped_count  integer := 0;
v_rates          record;
BEGIN
-- Authorization: only admin
IF NOT public.is_admin_user() THEN
RAISE EXCEPTION 'Acceso no autorizado';
END IF;

SELECT
ts.id, ts.slot_date, ts.departure_time, ts.tour_id,
t.name AS tour_name, t.agency_id, t.tour_type
INTO v_slot_record
FROM public.tour_slots ts
INNER JOIN public.tours t ON t.id = ts.tour_id
WHERE ts.id = p_slot_id
AND ts.slot_date < CURRENT_DATE
AND t.tour_type = 'receptivo';

IF NOT FOUND THEN
RETURN json_build_object(
'success', false,
'message', 'Slot no encontrado, no pertenece a un tour receptivo, o su fecha aun no ha pasado',
'created_count', 0, 'skipped_count', 0
);
END IF;

SELECT * INTO v_rates
FROM public.get_effective_commission_rates(v_slot_record.agency_id);

FOR v_booking_record IN
SELECT
b.id AS booking_id, b.agency_id, b.total_price,
b.commission_amount, b.service_charge, b.platform_revenue,
b.membership_service_fee_saved, b.preventa_comision_descuento,
b.travel_insurance_cost
FROM public.bookings b
WHERE b.slot_id = p_slot_id
AND b.status = 'confirmed'
AND b.payment_status = 'succeeded'
LOOP
SELECT * INTO v_breakdown
FROM public.calculate_booking_financial_breakdown(v_booking_record.booking_id);

INSERT INTO public.commission_records (
booking_id, agency_id, tour_id, tour_end_date, total_tour_price,
agency_commission_rate, agency_commission_amount,
service_charge_rate, service_charge_amount,
gross_service_charge_amount, membership_exemption_total,
preventa_comision_descuento,
payment_plan_service_charges, payment_plan_membership_exemptions,
optional_services_subtotal, optional_services_commission,
optional_services_service_charge, optional_services_agency_net,
supplements_subtotal, supplements_commission,
supplements_service_charge, supplements_agency_net,
platform_total_revenue, agency_net_amount, status, created_at
) VALUES (
v_booking_record.booking_id, v_booking_record.agency_id,
v_slot_record.tour_id, v_slot_record.slot_date, v_booking_record.total_price,
v_rates.agency_commission_rate, v_booking_record.commission_amount,
v_rates.service_charge_rate, v_booking_record.service_charge,
v_breakdown.gross_service_charge, v_breakdown.membership_exemption_total,
COALESCE(v_booking_record.preventa_comision_descuento, 0),
v_breakdown.payment_plan_service_charges, v_breakdown.payment_plan_membership_exemptions,
v_breakdown.optional_services_subtotal, v_breakdown.optional_services_commission,
v_breakdown.optional_services_service_charge, v_breakdown.optional_services_agency_net,
v_breakdown.supplements_subtotal, v_breakdown.supplements_commission,
v_breakdown.supplements_service_charge, v_breakdown.supplements_agency_net,
v_breakdown.platform_total_revenue, v_breakdown.agency_payout_total,
'pending', now()
)
ON CONFLICT (booking_id) DO UPDATE SET
total_tour_price = EXCLUDED.total_tour_price,
agency_commission_amount = EXCLUDED.agency_commission_amount,
service_charge_amount = EXCLUDED.service_charge_amount,
gross_service_charge_amount = EXCLUDED.gross_service_charge_amount,
membership_exemption_total = EXCLUDED.membership_exemption_total,
preventa_comision_descuento = EXCLUDED.preventa_comision_descuento,
payment_plan_service_charges = EXCLUDED.payment_plan_service_charges,
payment_plan_membership_exemptions = EXCLUDED.payment_plan_membership_exemptions,
optional_services_subtotal = EXCLUDED.optional_services_subtotal,
optional_services_commission = EXCLUDED.optional_services_commission,
optional_services_service_charge = EXCLUDED.optional_services_service_charge,
optional_services_agency_net = EXCLUDED.optional_services_agency_net,
supplements_subtotal = EXCLUDED.supplements_subtotal,
supplements_commission = EXCLUDED.supplements_commission,
supplements_service_charge = EXCLUDED.supplements_service_charge,
supplements_agency_net = EXCLUDED.supplements_agency_net,
platform_total_revenue = EXCLUDED.platform_total_revenue,
agency_net_amount = EXCLUDED.agency_net_amount,
updated_at = now();

v_created_count := v_created_count + 1;
END LOOP;

SELECT COUNT(*) INTO v_skipped_count
FROM public.bookings b
WHERE b.slot_id = p_slot_id
AND b.status = 'confirmed'
AND b.payment_status = 'succeeded'
AND NOT EXISTS (
SELECT 1 FROM public.commission_records cr WHERE cr.booking_id = b.id
);

RETURN json_build_object(
'success', true,
'message', 'Commission records creados/actualizados exitosamente',
'created_count', v_created_count,
'skipped_count', v_skipped_count
);
END;
$function$;

-- ============================================================
-- 10. create_commission_records_for_tour (authorization: admin only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_commission_records_for_tour(p_tour_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_tour_record        record;
v_booking_record     record;
v_breakdown          record;
v_commission_record_id uuid;
v_created_count      integer := 0;
v_updated_count      integer := 0;
v_skipped_count      integer := 0;
v_rates              record;
BEGIN
-- Authorization: only admin
IF NOT public.is_admin_user() THEN
RAISE EXCEPTION 'Acceso no autorizado';
END IF;

SELECT t.id, t.agency_id, t.end_date, t.name
INTO v_tour_record
FROM public.tours t
WHERE t.id = p_tour_id
AND t.end_date < CURRENT_DATE;

IF NOT FOUND THEN
RETURN json_build_object(
'success', false,
'message', 'Tour no encontrado o no ha finalizado',
'created_count', 0, 'skipped_count', 0
);
END IF;

SELECT * INTO v_rates
FROM public.get_effective_commission_rates(v_tour_record.agency_id);

FOR v_booking_record IN
SELECT
b.id AS booking_id, b.agency_id, b.total_price,
b.commission_amount, b.service_charge, b.platform_revenue,
b.membership_service_fee_saved, b.preventa_comision_descuento,
b.travel_insurance_cost
FROM public.bookings b
WHERE b.tour_id = p_tour_id
AND b.status = 'confirmed'
AND b.payment_status = 'succeeded'
LOOP
SELECT * INTO v_breakdown
FROM public.calculate_booking_financial_breakdown(v_booking_record.booking_id);

INSERT INTO public.commission_records (
booking_id, agency_id, tour_id, tour_end_date, total_tour_price,
agency_commission_rate, agency_commission_amount,
service_charge_rate, service_charge_amount,
gross_service_charge_amount, membership_exemption_total,
preventa_comision_descuento,
payment_plan_service_charges, payment_plan_membership_exemptions,
optional_services_subtotal, optional_services_commission,
optional_services_service_charge, optional_services_agency_net,
supplements_subtotal, supplements_commission,
supplements_service_charge, supplements_agency_net,
platform_total_revenue, agency_net_amount, status, created_at
) VALUES (
v_booking_record.booking_id, v_booking_record.agency_id,
p_tour_id, v_tour_record.end_date, v_booking_record.total_price,
v_rates.agency_commission_rate, v_booking_record.commission_amount,
v_rates.service_charge_rate, v_booking_record.service_charge,
v_breakdown.gross_service_charge, v_breakdown.membership_exemption_total,
COALESCE(v_booking_record.preventa_comision_descuento, 0),
v_breakdown.payment_plan_service_charges, v_breakdown.payment_plan_membership_exemptions,
v_breakdown.optional_services_subtotal, v_breakdown.optional_services_commission,
v_breakdown.optional_services_service_charge, v_breakdown.optional_services_agency_net,
v_breakdown.supplements_subtotal, v_breakdown.supplements_commission,
v_breakdown.supplements_service_charge, v_breakdown.supplements_agency_net,
v_breakdown.platform_total_revenue, v_breakdown.agency_payout_total,
'pending', now()
)
ON CONFLICT (booking_id) DO UPDATE SET
total_tour_price = EXCLUDED.total_tour_price,
agency_commission_amount = EXCLUDED.agency_commission_amount,
service_charge_amount = EXCLUDED.service_charge_amount,
gross_service_charge_amount = EXCLUDED.gross_service_charge_amount,
membership_exemption_total = EXCLUDED.membership_exemption_total,
preventa_comision_descuento = EXCLUDED.preventa_comision_descuento,
payment_plan_service_charges = EXCLUDED.payment_plan_service_charges,
payment_plan_membership_exemptions = EXCLUDED.payment_plan_membership_exemptions,
optional_services_subtotal = EXCLUDED.optional_services_subtotal,
optional_services_commission = EXCLUDED.optional_services_commission,
optional_services_service_charge = EXCLUDED.optional_services_service_charge,
optional_services_agency_net = EXCLUDED.optional_services_agency_net,
supplements_subtotal = EXCLUDED.supplements_subtotal,
supplements_commission = EXCLUDED.supplements_commission,
supplements_service_charge = EXCLUDED.supplements_service_charge,
supplements_agency_net = EXCLUDED.supplements_agency_net,
platform_total_revenue = EXCLUDED.platform_total_revenue,
agency_net_amount = EXCLUDED.agency_net_amount,
updated_at = now()
RETURNING id INTO v_commission_record_id;

v_created_count := v_created_count + 1;
END LOOP;

SELECT COUNT(*) INTO v_skipped_count
FROM public.bookings b
WHERE b.tour_id = p_tour_id
AND b.status = 'confirmed'
AND b.payment_status = 'succeeded'
AND NOT EXISTS (
SELECT 1 FROM public.commission_records cr WHERE cr.booking_id = b.id
);

RETURN json_build_object(
'success', true,
'message', 'Commission records creados/actualizados exitosamente',
'tour_name', v_tour_record.name,
'created_count', v_created_count,
'skipped_count', v_skipped_count
);

EXCEPTION WHEN OTHERS THEN
RETURN json_build_object(
'success', false,
'message', 'Error al crear commission records: ' || SQLERRM,
'created_count', v_created_count,
'skipped_count', v_skipped_count
);
END;
$function$
;
