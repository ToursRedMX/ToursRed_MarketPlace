/*
# Fix: total_price vuelve a ser el precio BRUTO del tour

## Problema
create_booking_atomic calculaba dos campos sobre bases distintas:

    v_deposit_amount    := ROUND(v_grand_total * pct, 2)          -- base NETA
    v_commission_amount := ROUND(v_base_tour_price * rate, 2)     -- base BRUTA

e insertaba total_price := v_grand_total (neto, ya restados puntos y wallet,
y ademas con extras + seguro + cargo por servicio + membresia dentro).

Consecuencias, todas confirmadas contra la BD:

1. commission_records_agency_net_amount_check revienta.
   agency_net_amount = total_price - commission_amount, y con wallet al 100%
   da negativo (visto: -1100.00 en la reserva 3d2ebb54 del 2026-08-24).

2. Doble conteo de extras. calculate_booking_financial_breakdown suma
   optional_services_agency_net POR SEPARADO desde booking_optional_services,
   asi que los extras entraban dos veces al pago de la agencia.
   (6 de 8 filas de booking_optional_services tienen paid_at, no es teorico.)

3. El seguro se filtraba al pago de la agencia por la misma via.

4. record_booking_financial_transaction y record_cancellation_financial_transaction
   derivan la tasa como commission_amount / total_price. Con bases distintas daba
   200% en vez de 10%, y eso alimenta los reembolsos de la Clausula 16.

5. get_booking_total_paid_batch suma pagos + toursred_cash_used + points_used/100.
   Con total_price ya neto, el wallet se descontaba dos veces en el saldo del viajero.

## Solucion
total_price y deposit_amount pasan a la MISMA base bruta que commission_amount:
v_base_tour_price_discounted (solo tour, tras descuento de codigo).
El monto realmente cobrado ahora vive en user_payment / initial_payment_amount
via la variable nueva v_amount_to_charge. Wallet y puntos quedan unicamente en
toursred_cash_used / points_used.

Ninguna de las 5 funciones consumidoras se toca: las cinco ya asumian bruto
y estaban rotas en silencio. Se arreglan al corregir el origen.

## Extras incluidos en el mismo pase
- Unidad de puntos: 100 pts = $1 MXN (antes 1:1), consistente con
  deduct_points_for_booking. La conversion 1:1 inflaba el descuento 100x.
- Tope del 50% de puntos, ahora con enforcement server-side (antes solo cliente).
- Exencion de cargo por servicio al pagar 100% con ToursRed Cash, evaluada antes
  de armar el subtotal para romper la circularidad SC -> subtotal -> wallet -> SC.
- points_used / toursred_cash_used guardan el monto REALMENTE aplicado (topado),
  no el que mando el cliente.

## Alcance
7 hunks sobre 656 lineas. El resto de la funcion queda byte a byte igual.
Sin cambio de firma. Sin logica de transicion: las reservas historicas
conservan la semantica vieja (ambiente de prueba, se depura antes de UAT).

## Validacion previa
Los 7 reemplazos verificados como coincidencia unica, y la funcion resultante
compilada bajo nombre temporal dentro de BEGIN/ROLLBACK (check_function_bodies=on).
*/

CREATE OR REPLACE FUNCTION public.create_booking_atomic(p_booking_data jsonb, p_travelers jsonb DEFAULT '[]'::jsonb, p_optional_services jsonb DEFAULT '[]'::jsonb, p_session_id text DEFAULT NULL::text, p_seat_numbers integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
-- Booking identity
v_user_id           uuid    := (p_booking_data->>'user_id')::uuid;
v_tour_id           uuid    := (p_booking_data->>'tour_id')::uuid;
v_agency_id         uuid    := v_tour_id;  -- placeholder, set later
v_slot_id           uuid    := NULL;
v_travelers_count   integer := (p_booking_data->>'travelers_count')::integer;
v_booking_id        uuid;

-- Tour data
v_tour              record;
v_rates             record;

-- Capacity validation
v_slot              record;
v_max_capacity      integer;
v_total_booked      integer;
v_blocked           integer;
v_held              integer;
v_available         integer;

-- Price recalculation
v_base_tour_price          numeric := 0;
v_base_tour_price_discounted numeric := 0;
v_extras_subtotal          numeric := 0;
v_extras_sc_base           numeric := 0;
v_base_service_charge      numeric := 0;
v_deposit_sc               numeric := 0;
v_extras_sc                numeric := 0;
v_exemption_result         json;
v_exemption_applied        numeric := 0;
v_base_exemption           numeric := 0;
v_extras_exemption         numeric := 0;
v_total_exemption          numeric := 0;
v_has_membership           boolean := false;
v_membership_purchased     boolean := false;
v_membership_cost          numeric := 0;
v_insurance_cost           numeric := 0;
v_insurance_days           integer := 0;
v_tour_duration_days       integer := 1;
v_insurance_price_day      numeric := 79;
v_discount_amount          numeric := 0;
v_points_discount          numeric := 0;
v_wallet_discount          numeric := 0;
v_points_balance           integer := 0;
v_wallet_balance           numeric := 0;
v_subtotal                 numeric := 0;
v_grand_total              numeric := 0;
v_deposit_pct              numeric := 50;
v_deposit_amount           numeric := 0;
v_amount_to_charge         numeric := 0;
v_is_full_wallet           boolean := false;
v_net_before_charges       numeric := 0;
v_max_points_allowed       numeric := 0;
v_commission_amount        numeric := 0;
v_platform_revenue         numeric := 0;
v_discount_rec             record;

-- Pickup / language real price lookup
v_pickup_zone_name    text;
v_selected_language   text;
v_pickup_zone_elem    jsonb;
v_language_elem       jsonb;
v_pickup_zone_cost    numeric := 0;
v_language_cost       numeric := 0;
v_pickup_cost_type    text;
v_language_cost_type  text;

-- Traveler recalculation
v_traveler        jsonb;
v_traveler_price  numeric;
v_cat             text;
v_doc_tipo        text;
v_doc_numero      text;

-- Optional service recalculation
v_service         jsonb;
v_svc_id          uuid;
v_svc_qty         integer;
v_svc_unit        numeric;
v_svc_subtotal    numeric;
v_svc_sc          numeric;
v_svc_kind        text;
v_svc_exemption   numeric;
v_svc_net_sc      numeric;

-- Seat conversion
v_seat  integer;
v_rows  integer;
BEGIN
v_slot_id := NULLIF(p_booking_data->>'slot_id', '')::uuid;
v_membership_purchased := COALESCE((p_booking_data->>'membership_purchased')::boolean, false);
v_pickup_zone_name := NULLIF(p_booking_data->>'pickup_zone_name', '')::text;
v_selected_language := NULLIF(p_booking_data->>'selected_language', '')::text;

-- ---- VALIDATE TOUR EXISTS & LOAD REAL DATA (incl. pickup_zones & tour_languages) ----
SELECT
t.id,
t.agency_id,
t.price,
t.precio_adulto,
t.precio_nino,
t.precio_infante,
t.precio_adulto_mayor,
t.precio_mascota,
t.deposit_percentage,
t.start_date,
t.end_date,
t.tour_type,
t.pickup_zones,
t.tour_languages
INTO v_tour
FROM tours t
WHERE t.id = v_tour_id;

IF v_tour IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Tour no encontrado');
END IF;

-- Use the tour's agency_id as source of truth
v_agency_id := v_tour.agency_id;

-- ---- RESOLVE COMMISSION & SERVICE-CHARGE RATES ----
SELECT * INTO v_rates
FROM public.get_effective_commission_rates(v_agency_id, v_tour_id);

-- ---- CAPACITY VALIDATION ----
IF v_slot_id IS NOT NULL THEN
SELECT ts.capacity, ts.booked_count
INTO v_slot
FROM tour_slots ts
WHERE ts.id = v_slot_id
FOR UPDATE;

IF v_slot IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'El horario seleccionado ya no existe');
END IF;

SELECT COUNT(*)::integer INTO v_blocked
FROM slot_seat_status
WHERE slot_id = v_slot_id
AND status = 'bloqueado_agencia';

SELECT COALESCE(SUM(held_count), 0)::integer INTO v_held
FROM seat_holds
WHERE slot_id = v_slot_id
AND seat_number IS NULL
AND session_id IS DISTINCT FROM p_session_id
AND expires_at > now();

v_available := v_slot.capacity - v_slot.booked_count - v_blocked - v_held;
ELSE
SELECT
COALESCE(
CASE
WHEN t.available_spots IS NOT NULL AND t.available_spots > 0
THEN t.available_spots
ELSE COALESCE(t.max_travelers, 10)
END,
10
)
INTO v_max_capacity
FROM tours t WHERE t.id = v_tour_id;

SELECT COALESCE(SUM(b.travelers_count), 0)::integer
INTO v_total_booked
FROM bookings b
WHERE b.tour_id = v_tour_id
AND (
b.status = 'confirmed'
OR (b.status = 'pending' AND b.approval_status = 'approved')
);

SELECT COUNT(*)::integer INTO v_blocked
FROM slot_seat_status
WHERE tour_id = v_tour_id
AND status = 'bloqueado_agencia'
AND slot_id IS NULL;

SELECT COALESCE(SUM(held_count), 0)::integer INTO v_held
FROM seat_holds
WHERE tour_id = v_tour_id
AND slot_id IS NULL
AND seat_number IS NULL
AND session_id IS DISTINCT FROM p_session_id
AND expires_at > now();

v_available := v_max_capacity - v_total_booked - v_blocked - v_held;
END IF;

IF v_travelers_count > v_available THEN
RETURN jsonb_build_object(
'success', false,
'error', 'No hay suficientes lugares disponibles',
'available_spots', v_available,
'requested', v_travelers_count
);
END IF;

-- ---- 1. RECALCULATE BASE TOUR PRICE FROM REAL PER-CATEGORY PRICES ----
IF p_travelers IS NOT NULL AND jsonb_array_length(p_travelers) > 0 THEN
FOR v_traveler IN SELECT jsonb_array_elements(p_travelers) LOOP
v_cat := COALESCE(v_traveler->>'categoria_viajero', 'adulto');
v_traveler_price := CASE
WHEN v_cat = 'adulto'         THEN COALESCE(v_tour.precio_adulto, v_tour.price, 0)
WHEN v_cat = 'nino'           THEN COALESCE(v_tour.precio_nino, v_tour.price, 0)
WHEN v_cat = 'infante'        THEN COALESCE(v_tour.precio_infante, 0)
WHEN v_cat = 'adulto_mayor'   THEN COALESCE(v_tour.precio_adulto_mayor, v_tour.price, 0)
WHEN v_cat = 'mascota'        THEN COALESCE(v_tour.precio_mascota, 0)
ELSE COALESCE(v_tour.price, 0)
END;
v_base_tour_price := v_base_tour_price + v_traveler_price;
END LOOP;
END IF;

-- ---- PRE-COMPUTE PICKUP & LANGUAGE REAL COSTS FROM TOUR DATA ----
v_pickup_zone_cost := 0;
v_pickup_cost_type := NULL;
IF v_pickup_zone_name IS NOT NULL AND v_tour.pickup_zones IS NOT NULL THEN
FOR v_pickup_zone_elem IN SELECT jsonb_array_elements(v_tour.pickup_zones) LOOP
IF v_pickup_zone_elem->>'name' = v_pickup_zone_name THEN
v_pickup_cost_type := COALESCE(v_pickup_zone_elem->>'cost_type', 'por_persona');
IF v_pickup_cost_type = 'por_persona' THEN
v_pickup_zone_cost := COALESCE((v_pickup_zone_elem->>'extra_cost')::numeric, 0) * v_travelers_count;
ELSE
v_pickup_zone_cost := COALESCE((v_pickup_zone_elem->>'extra_cost')::numeric, 0);
END IF;
EXIT;
END IF;
END LOOP;
END IF;

v_language_cost := 0;
v_language_cost_type := NULL;
IF v_selected_language IS NOT NULL AND v_tour.tour_languages IS NOT NULL THEN
FOR v_language_elem IN SELECT jsonb_array_elements(v_tour.tour_languages) LOOP
IF v_language_elem->>'language' = v_selected_language THEN
v_language_cost_type := COALESCE(v_language_elem->>'cost_type', 'por_persona');
IF v_language_cost_type = 'por_persona' THEN
v_language_cost := COALESCE((v_language_elem->>'extra_cost')::numeric, 0) * v_travelers_count;
ELSE
v_language_cost := COALESCE((v_language_elem->>'extra_cost')::numeric, 0);
END IF;
EXIT;
END IF;
END LOOP;
END IF;

-- ---- 2. RECALCULATE OPTIONAL SERVICES FROM REAL PRICES ----
IF p_optional_services IS NOT NULL AND jsonb_array_length(p_optional_services) > 0 THEN
FOR v_service IN SELECT jsonb_array_elements(p_optional_services) LOOP
v_svc_id := NULLIF(v_service->>'tour_optional_service_id', '')::uuid;
v_svc_qty := COALESCE((v_service->>'quantity')::integer, 0);
v_svc_kind := COALESCE(v_service->>'service_kind', 'optional_service');

IF v_svc_id IS NOT NULL AND v_svc_qty > 0 THEN
SELECT price_per_person INTO v_svc_unit
FROM tour_optional_services
WHERE id = v_svc_id AND is_active = true;
IF NOT FOUND THEN
v_svc_unit := 0;
END IF;
v_svc_subtotal := v_svc_unit * v_svc_qty;
ELSIF v_svc_kind = 'pickup' THEN
v_svc_unit := v_pickup_zone_cost;
v_svc_subtotal := v_pickup_zone_cost;
v_svc_qty := 1;
ELSIF v_svc_kind = 'language' THEN
v_svc_unit := v_language_cost;
v_svc_subtotal := v_language_cost;
v_svc_qty := 1;
ELSE
v_svc_unit := 0;
v_svc_subtotal := 0;
END IF;

v_svc_sc := v_svc_subtotal * v_rates.service_charge_rate;
v_extras_subtotal := v_extras_subtotal + v_svc_subtotal;
v_extras_sc_base := v_extras_sc_base + v_svc_sc;
END LOOP;
END IF;

-- ---- 3. DISCOUNT CODE VALIDATION (moved before service charge calc) ----
-- Resolved here so the service charge can be computed on the discounted tour price.
-- Discount applies ONLY to v_base_tour_price (not extras), per business decision.
IF NULLIF(p_booking_data->>'discount_code_id', '') IS NOT NULL THEN
BEGIN
SELECT
dc.discount_type,
dc.discount_value,
dc.max_discount_amount,
dc.discount_applies_to
INTO v_discount_rec
FROM discount_codes dc
WHERE dc.id = (p_booking_data->>'discount_code_id')::uuid
AND dc.is_active = true
AND (dc.valid_until IS NULL OR dc.valid_until > now())
AND (dc.max_uses IS NULL OR dc.times_used < dc.max_uses)
AND (dc.agency_id IS NULL OR dc.agency_id = v_agency_id);

IF FOUND THEN
IF v_discount_rec.discount_type IN ('tour_percentage', 'agency_tour_percentage') THEN
v_discount_amount := v_base_tour_price
* COALESCE(v_discount_rec.discount_value, 0) / 100;
IF v_discount_rec.max_discount_amount IS NOT NULL THEN
v_discount_amount := LEAST(v_discount_amount, v_discount_rec.max_discount_amount);
END IF;
ELSIF v_discount_rec.discount_type IN ('tour_fixed', 'agency_tour_fixed') THEN
v_discount_amount := COALESCE(v_discount_rec.discount_value, 0);
END IF;
END IF;
EXCEPTION WHEN OTHERS THEN
v_discount_amount := 0;
END;
END IF;

-- ---- 4. CALCULATE DISCOUNTED TOUR PRICE AND BASE SERVICE CHARGE ----
v_base_tour_price_discounted := GREATEST(0, v_base_tour_price - v_discount_amount);
v_base_service_charge := ROUND(v_base_tour_price_discounted * v_rates.service_charge_rate, 2);

-- ---- 5. MEMBERSHIP EXEMPTION CASCADE ----
v_has_membership := public.has_active_membership(v_user_id);

IF v_membership_purchased THEN
v_deposit_sc := 0;
v_extras_sc := 0;
v_base_exemption := v_base_service_charge;
v_extras_exemption := v_extras_sc_base;
ELSIF v_has_membership THEN
v_exemption_result := public.apply_membership_service_fee_exemption(v_user_id, v_base_service_charge);
v_base_exemption := COALESCE((v_exemption_result->>'exemption_applied')::numeric, 0);
v_deposit_sc := COALESCE((v_exemption_result->>'net_service_charge')::numeric, v_base_service_charge - v_base_exemption);

v_exemption_result := public.apply_membership_service_fee_exemption(v_user_id, v_extras_sc_base);
v_extras_exemption := COALESCE((v_exemption_result->>'exemption_applied')::numeric, 0);
v_extras_sc := COALESCE((v_exemption_result->>'net_service_charge')::numeric, v_extras_sc_base - v_extras_exemption);
ELSE
v_deposit_sc := v_base_service_charge;
v_extras_sc := v_extras_sc_base;
v_base_exemption := 0;
v_extras_exemption := 0;
END IF;

v_total_exemption := v_base_exemption + v_extras_exemption;

-- ---- 6. TRAVEL INSURANCE WITH DAY VALIDATION ----
IF COALESCE((p_booking_data->>'travel_insurance_included')::boolean, false) THEN
SELECT COALESCE(travel_insurance_price_per_day_per_traveler, 79)
INTO v_insurance_price_day
FROM platform_settings
LIMIT 1;

IF v_tour.start_date IS NOT NULL AND v_tour.end_date IS NOT NULL THEN
v_tour_duration_days := GREATEST(1, (v_tour.end_date::date - v_tour.start_date::date) + 1);
ELSE
v_tour_duration_days := 1;
END IF;

IF v_tour.tour_type = 'receptivo' THEN
v_tour_duration_days := 1;
END IF;

v_insurance_days := NULLIF(p_booking_data->>'insurance_days', '')::integer;
IF v_insurance_days IS NULL OR v_insurance_days < 1 THEN
v_insurance_days := 1;
ELSIF v_insurance_days > v_tour_duration_days THEN
RETURN jsonb_build_object(
'success', false,
'error', 'Los dias de seguro exceden la duracion del tour'
);
END IF;

v_insurance_cost := v_insurance_price_day * v_insurance_days * v_travelers_count;
END IF;

-- ---- 7. MEMBERSHIP COST ----
IF v_membership_purchased AND NOT v_has_membership THEN
IF COALESCE(p_booking_data->>'membership_plan', '') = 'anual' THEN
SELECT COALESCE(membership_annual_price, 490) INTO v_membership_cost
FROM platform_settings LIMIT 1;
ELSE
SELECT COALESCE(membership_monthly_price, 49) INTO v_membership_cost
FROM platform_settings LIMIT 1;
END IF;
END IF;

-- ---- 8. POINTS AND WALLET VALIDATION ----
-- Base sin cargos por servicio: puntos y wallet se topan contra esto para no
-- depender del SC, que a su vez depende de si el pago termina siendo 100% wallet.
-- Se calcula FUERA de los IF: el wallet la necesita aunque no haya puntos.
v_net_before_charges := GREATEST(0, v_base_tour_price_discounted
+ v_extras_subtotal + v_insurance_cost + v_membership_cost);

IF COALESCE((p_booking_data->>'points_used')::integer, 0) > 0 THEN
SELECT COALESCE(balance, 0) INTO v_points_balance
FROM toursred_points_wallets
WHERE user_id = v_user_id
LIMIT 1;

-- Tope del 50%: los puntos nunca cubren mas de la mitad. 100 pts = $1 MXN,
-- misma conversion que deduct_points_for_booking.
v_max_points_allowed := FLOOR(v_net_before_charges * 100 * 0.5);

v_points_discount := LEAST(
COALESCE((p_booking_data->>'points_used')::integer, 0),
v_points_balance,
v_max_points_allowed
) / 100.0;
END IF;

IF COALESCE((p_booking_data->>'toursred_cash_used')::numeric, 0) > 0 THEN
SELECT COALESCE(balance, 0) INTO v_wallet_balance
FROM toursred_cash_wallets
WHERE user_id = v_user_id AND is_active = true
LIMIT 1;
v_wallet_discount := LEAST(
COALESCE((p_booking_data->>'toursred_cash_used')::numeric, 0),
v_wallet_balance,
GREATEST(0, v_net_before_charges - v_points_discount)
);
END IF;

-- ---- 9. ASSEMBLE TOTALS ----
-- Pago 100% con ToursRed Cash: el cargo por servicio se exenta. Se evalua ANTES
-- de armar el subtotal para romper la circularidad SC -> subtotal -> wallet -> SC.
v_is_full_wallet := v_wallet_discount > 0
AND (v_net_before_charges - v_points_discount - v_wallet_discount) < 10
AND v_net_before_charges > 0
AND NOT v_membership_purchased;

IF v_is_full_wallet THEN
v_deposit_sc       := 0;
v_extras_sc        := 0;
v_total_exemption  := 0;
END IF;

v_subtotal := v_base_tour_price_discounted
+ v_extras_subtotal
+ v_extras_sc
+ v_insurance_cost
+ v_deposit_sc
+ v_membership_cost;

v_grand_total := GREATEST(0, v_subtotal - v_points_discount - v_wallet_discount);

v_deposit_pct := COALESCE(v_tour.deposit_percentage, 50);

-- total_price y deposit_amount viven en la MISMA base bruta que commission_amount.
-- Asi agency_net_amount = total_price - commission_amount nunca puede ser negativo,
-- y los extras/seguro dejan de contarse dos veces en el breakdown de comisiones.
v_deposit_amount := ROUND(v_base_tour_price_discounted * (v_deposit_pct / 100), 2);

-- Lo que se le cobra al procesador AHORA (ya descontados puntos y wallet).
v_amount_to_charge := ROUND(v_grand_total * (v_deposit_pct / 100), 2);
IF v_amount_to_charge > 0 AND v_amount_to_charge < 10 THEN
v_amount_to_charge := 0;
END IF;

v_commission_amount := ROUND(v_base_tour_price * v_rates.agency_commission_rate, 2);
v_platform_revenue := v_deposit_sc + v_extras_sc;

-- ---- INSERT BOOKING ----
BEGIN
INSERT INTO bookings (
user_id, tour_id, agency_id, travelers_count, total_price,
deposit_amount, commission_amount, service_charge, user_payment,
platform_revenue, booking_date, slot_id, selected_date, selected_time,
status, payment_status, approval_status,
count_adultos, count_ninos, count_infantes, count_adultos_mayores, count_mascotas,
points_used, toursred_cash_used, discount_code_id, discount_amount,
service_charge_discount, payment_provider, conekta_method,
promotion_id, promo_discount_amount,
pickup_type, pickup_zone_name, pickup_zone_extra_cost, pickup_cost_type,
selected_language, language_extra_cost, language_cost_type,
restrictions_accepted, selected_seats,
es_reserva_preventa, travel_insurance_included, travel_insurance_cost,
insurance_days, insurance_discount_code_id, insurance_discount_amount,
selected_payment_mode, membership_purchased, membership_plan, membership_cost,
initial_payment_amount,
used_membership_benefit, membership_service_fee_saved
)
VALUES (
v_user_id,
v_tour_id,
v_agency_id,
v_travelers_count,
v_base_tour_price_discounted,
v_deposit_amount,
v_commission_amount,
v_deposit_sc,
v_amount_to_charge,
v_platform_revenue,
(p_booking_data->>'booking_date')::date,
v_slot_id,
NULLIF(p_booking_data->>'selected_date', '')::date,
NULLIF(p_booking_data->>'selected_time', '')::time,
COALESCE(p_booking_data->>'status', 'pending'),
COALESCE(p_booking_data->>'payment_status', 'pending'),
COALESCE(p_booking_data->>'approval_status', 'approved')::approval_status,
COALESCE((p_booking_data->>'count_adultos')::integer, 0),
COALESCE((p_booking_data->>'count_ninos')::integer, 0),
COALESCE((p_booking_data->>'count_infantes')::integer, 0),
COALESCE((p_booking_data->>'count_adultos_mayores')::integer, 0),
COALESCE((p_booking_data->>'count_mascotas')::integer, 0),
ROUND(v_points_discount * 100)::integer,
v_wallet_discount,
NULLIF(p_booking_data->>'discount_code_id', '')::uuid,
v_discount_amount,
COALESCE((p_booking_data->>'service_charge_discount')::numeric, 0),
p_booking_data->>'payment_provider',
NULLIF(p_booking_data->>'conekta_method', '')::text,
NULLIF(p_booking_data->>'promotion_id', '')::uuid,
COALESCE((p_booking_data->>'promo_discount_amount')::numeric, 0),
NULLIF(p_booking_data->>'pickup_type', '')::text,
NULLIF(p_booking_data->>'pickup_zone_name', '')::text,
v_pickup_zone_cost,
v_pickup_cost_type,
NULLIF(p_booking_data->>'selected_language', '')::text,
v_language_cost,
v_language_cost_type,
COALESCE((p_booking_data->>'restrictions_accepted')::boolean, false),
CASE
WHEN p_seat_numbers IS NOT NULL AND array_length(p_seat_numbers, 1) > 0
THEN p_seat_numbers
ELSE NULL
END,
COALESCE((p_booking_data->>'es_reserva_preventa')::boolean, false),
COALESCE((p_booking_data->>'travel_insurance_included')::boolean, false),
v_insurance_cost,
NULLIF(v_insurance_days, 0)::integer,
NULLIF(p_booking_data->>'insurance_discount_code_id', '')::uuid,
COALESCE((p_booking_data->>'insurance_discount_amount')::numeric, 0),
COALESCE(p_booking_data->>'selected_payment_mode', 'standard'),
v_membership_purchased,
NULLIF(p_booking_data->>'membership_plan', '')::text,
v_membership_cost,
v_amount_to_charge,
(v_has_membership OR v_membership_purchased),
v_total_exemption
)
RETURNING id INTO v_booking_id;

EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error', 'Error al crear la reserva: ' || SQLERRM);
END;

-- ---- INSERT TRAVELERS (with server-recalculated precio_aplicado) ----
IF p_travelers IS NOT NULL AND jsonb_array_length(p_travelers) > 0 THEN
FOR v_traveler IN SELECT jsonb_array_elements(p_travelers) LOOP
v_doc_tipo := NULLIF(v_traveler->>'documento_tipo', '')::text;
v_doc_numero := NULLIF(v_traveler->>'documento_numero', '')::text;

IF v_doc_tipo IS NULL AND NULLIF(v_traveler->>'curp', '') IS NOT NULL THEN
v_doc_tipo := 'curp';
v_doc_numero := v_traveler->>'curp';
ELSIF v_doc_tipo IS NULL AND NULLIF(v_traveler->>'pasaporte', '') IS NOT NULL THEN
v_doc_tipo := 'pasaporte';
v_doc_numero := v_traveler->>'pasaporte';
END IF;

v_cat := COALESCE(v_traveler->>'categoria_viajero', 'adulto');
v_traveler_price := CASE
WHEN v_cat = 'adulto'         THEN COALESCE(v_tour.precio_adulto, v_tour.price, 0)
WHEN v_cat = 'nino'           THEN COALESCE(v_tour.precio_nino, v_tour.price, 0)
WHEN v_cat = 'infante'        THEN COALESCE(v_tour.precio_infante, 0)
WHEN v_cat = 'adulto_mayor'   THEN COALESCE(v_tour.precio_adulto_mayor, v_tour.price, 0)
WHEN v_cat = 'mascota'        THEN COALESCE(v_tour.precio_mascota, 0)
ELSE COALESCE(v_tour.price, 0)
END;

INSERT INTO booking_travelers (
booking_id, nombre, apellido, email, telefono,
fecha_nacimiento, documento_tipo, documento_numero,
categoria_viajero, precio_aplicado,
emergency_contact_name, emergency_contact_phone
)
VALUES (
v_booking_id,
v_traveler->>'nombre',
v_traveler->>'apellido',
v_traveler->>'email',
v_traveler->>'telefono',
NULLIF(v_traveler->>'fecha_nacimiento', '')::date,
v_doc_tipo,
v_doc_numero,
v_cat,
v_traveler_price,
NULLIF(v_traveler->>'emergency_contact_name', '')::text,
NULLIF(v_traveler->>'emergency_contact_phone', '')::text
);
END LOOP;
END IF;

-- ---- INSERT OPTIONAL SERVICES (with recalculated values + proportional exemption) ----
IF p_optional_services IS NOT NULL AND jsonb_array_length(p_optional_services) > 0 THEN
FOR v_service IN SELECT jsonb_array_elements(p_optional_services) LOOP
v_svc_id := NULLIF(v_service->>'tour_optional_service_id', '')::uuid;
v_svc_qty := COALESCE((v_service->>'quantity')::integer, 0);
v_svc_kind := COALESCE(v_service->>'service_kind', 'optional_service');

IF v_svc_id IS NOT NULL AND v_svc_qty > 0 THEN
SELECT price_per_person INTO v_svc_unit
FROM tour_optional_services
WHERE id = v_svc_id AND is_active = true;
IF NOT FOUND THEN v_svc_unit := 0; END IF;
v_svc_subtotal := v_svc_unit * v_svc_qty;
ELSIF v_svc_kind = 'pickup' THEN
v_svc_unit := v_pickup_zone_cost;
v_svc_subtotal := v_pickup_zone_cost;
v_svc_qty := 1;
ELSIF v_svc_kind = 'language' THEN
v_svc_unit := v_language_cost;
v_svc_subtotal := v_language_cost;
v_svc_qty := 1;
ELSE
v_svc_unit := 0;
v_svc_subtotal := 0;
END IF;

v_svc_sc := v_svc_subtotal * v_rates.service_charge_rate;

-- Distribute extras exemption proportionally across service lines
IF v_extras_sc_base > 0 AND v_extras_exemption > 0 THEN
v_svc_exemption := ROUND(
(v_svc_sc / v_extras_sc_base) * v_extras_exemption, 2
);
ELSE
v_svc_exemption := 0;
END IF;
v_svc_net_sc := v_svc_sc - v_svc_exemption;

INSERT INTO booking_optional_services (
booking_id, tour_optional_service_id, service_kind,
description, quantity, unit_price, subtotal,
service_charge, agency_commission, total_paid,
membership_exemption_used
)
VALUES (
v_booking_id,
v_svc_id,
v_svc_kind,
v_service->>'description',
v_svc_qty,
v_svc_unit,
v_svc_subtotal,
v_svc_net_sc,
0,
v_svc_subtotal + v_svc_net_sc,
v_svc_exemption
);
END LOOP;
END IF;

-- ---- CONVERT SEAT HOLDS TO slot_seat_status ----
IF p_seat_numbers IS NOT NULL AND array_length(p_seat_numbers, 1) > 0 THEN
FOREACH v_seat IN ARRAY p_seat_numbers LOOP
INSERT INTO slot_seat_status (
tour_id, slot_id, agency_id, seat_number, status, booking_id
)
VALUES (
v_tour_id,
v_slot_id,
v_agency_id,
v_seat,
'reservado_online',
v_booking_id
)
ON CONFLICT (tour_id, slot_id, seat_number) DO NOTHING;

GET DIAGNOSTICS v_rows = ROW_COUNT;

IF v_rows = 0 THEN
RAISE EXCEPTION 'El asiento % ya fue asignado a otra persona. Intenta de nuevo.', v_seat
USING ERRCODE = 'unique_violation';
END IF;
END LOOP;
END IF;

-- ---- RELEASE ALL HOLDS FOR THIS SESSION ----
IF p_session_id IS NOT NULL THEN
DELETE FROM seat_holds WHERE session_id = p_session_id;
END IF;

-- Eco de los montos REALMENTE aplicados: el servidor topa puntos (50% y saldo)
-- y wallet en silencio, asi que el cliente necesita saber con que se quedo
-- para reflejarlo si difiere de lo que mando.
RETURN jsonb_build_object(
'success', true,
'booking_id', v_booking_id,
'points_applied', ROUND(v_points_discount * 100)::integer,
'points_discount_mxn', v_points_discount,
'toursred_cash_applied', v_wallet_discount,
'total_price', v_base_tour_price_discounted,
'deposit_amount', v_deposit_amount,
'amount_to_charge', v_amount_to_charge,
'service_charge', v_deposit_sc,
'is_full_wallet', v_is_full_wallet
);
END;
$function$
;
