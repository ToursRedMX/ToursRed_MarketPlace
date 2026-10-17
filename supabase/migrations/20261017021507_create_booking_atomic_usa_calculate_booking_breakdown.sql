-- Segunda mitad del paso 1 de la centralizacion de costos: create_booking_atomic
-- delega el calculo (secciones 1-9 de la version anterior) en
-- calculate_booking_breakdown (migracion 20261017021213) en vez de calcularlo inline.
--
-- Queda sin mover, A PROPOSITO, una pieza chica y trivial: el booleano
-- es_per_vehicle (3 columnas del tour con un AND) se sigue calculando aqui tambien,
-- porque create_booking_atomic lo necesita ANTES de poder llamar a
-- calculate_booking_breakdown -- lo usa para decidir paid_spots (garantia de salida),
-- que a su vez es un INPUT de la funcion nueva. Es la misma formula en los dos lados,
-- comentada en ambos; no es logica de PRECIO, solo una bandera.
--
-- Todo lo demas que se repetia por renglon (traveler price en el INSERT de
-- booking_travelers, el desglose de servicios opcionales en su propio INSERT) sigue
-- en su lugar, pero ahora usando preventa_ratio/pickup_zone_cost/language_cost/etc.
-- que devuelve calculate_booking_breakdown en vez de variables locales recalculadas.

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

-- Capacity validation
v_slot              record;
v_max_capacity      integer;
v_total_booked      integer;
v_blocked           integer;
v_held              integer;
v_available         integer;

v_es_per_vehicle           boolean := false;
v_paid_spots               integer := 0;
v_missing_for_slot         integer := 0;

-- Resultado de calculate_booking_breakdown
v_breakdown                jsonb;
v_preventa_ratio           numeric := 1;
v_pickup_zone_cost         numeric := 0;
v_pickup_cost_type         text;
v_language_cost            numeric := 0;
v_language_cost_type       text;
v_service_charge_rate      numeric := 0;
v_extras_sc_base           numeric := 0;
v_extras_exemption         numeric := 0;
v_amount_to_charge         numeric := 0;
v_deposit_sc               numeric := 0;
v_points_discount          numeric := 0;
v_wallet_discount          numeric := 0;
v_promo_id                 uuid;
v_promo_type                text;
v_promo_discount            numeric := 0;
v_promo_grupos_con          integer := 0;

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

-- ---- SECURITY: el creador de la reserva debe ser el usuario autenticado ----
IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_user_id THEN
RETURN jsonb_build_object('success', false, 'error', 'No autorizado: el user_id no coincide con la sesion autenticada');
END IF;

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
t.payment_option,
t.payment_plan_mode,
t.installment_definitions,
t.start_date,
t.end_date,
t.tour_type,
t.pickup_zones,
t.tour_languages,
t.preventa_precio_especial,
t.preventa_tipo_descuento,
t.preventa_descuento_valor,
t.activity_type,
t.receptivo_modality,
t.transfer_pricing_mode,
t.min_travelers_required,
t.politica_bajo_minimo
INTO v_tour
FROM tours t
WHERE t.id = v_tour_id;

IF v_tour IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Tour no encontrado');
END IF;

-- Use the tour's agency_id as source of truth
v_agency_id := v_tour.agency_id;

-- ---- PRECIO FIJO POR VEHICULO: solo para decidir paid_spots abajo. La misma
-- formula se repite dentro de calculate_booking_breakdown (necesita su propia
-- copia para el calculo de precio); ver encabezado de esta migracion.
v_es_per_vehicle := (
  v_tour.activity_type = 'transport'
  AND v_tour.receptivo_modality = 'privado'
  AND v_tour.transfer_pricing_mode = 'per_vehicle'
);

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

-- ---- GARANTIA DE SALIDA: cuantos lugares se PAGAN ----
IF v_es_per_vehicle OR v_slot_id IS NULL OR v_tour.min_travelers_required IS NULL OR v_tour.min_travelers_required <= 1 THEN
  v_paid_spots := v_travelers_count;
ELSE
  v_missing_for_slot := GREATEST(0, v_tour.min_travelers_required - v_slot.booked_count - v_travelers_count);
  IF v_tour.politica_bajo_minimo = 'exige_pago_minimo' THEN
    v_paid_spots := v_travelers_count + v_missing_for_slot;
  ELSIF COALESCE((p_booking_data->>'pagar_minimo_garantizado')::boolean, false) THEN
    v_paid_spots := v_travelers_count + v_missing_for_slot;
  ELSE
    v_paid_spots := v_travelers_count;
  END IF;
END IF;

-- ---- CALCULO CENTRALIZADO: precio, promociones, descuentos, exenciones,
-- seguro, anticipo, tope de puntos/wallet y totales (antes, secciones 1-9
-- de esta misma funcion; ver migracion 20261017021213). ----
v_breakdown := public.calculate_booking_breakdown(
  v_tour_id, v_user_id, p_booking_data, p_travelers, p_optional_services,
  v_paid_spots, v_travelers_count
);

IF NOT COALESCE((v_breakdown->>'success')::boolean, false) THEN
RETURN v_breakdown;
END IF;

v_preventa_ratio      := COALESCE((v_breakdown->>'preventa_ratio')::numeric, 1);
v_pickup_zone_cost    := COALESCE((v_breakdown->>'pickup_zone_cost')::numeric, 0);
v_pickup_cost_type    := v_breakdown->>'pickup_cost_type';
v_language_cost       := COALESCE((v_breakdown->>'language_cost')::numeric, 0);
v_language_cost_type  := v_breakdown->>'language_cost_type';
v_service_charge_rate := COALESCE((v_breakdown->>'service_charge_rate')::numeric, 0);
v_extras_sc_base      := COALESCE((v_breakdown->>'extras_sc_base')::numeric, 0);
v_extras_exemption    := COALESCE((v_breakdown->>'extras_exemption')::numeric, 0);
v_amount_to_charge    := COALESCE((v_breakdown->>'amount_to_charge')::numeric, 0);
v_deposit_sc          := COALESCE((v_breakdown->>'deposit_sc')::numeric, 0);
v_points_discount     := COALESCE((v_breakdown->>'points_discount')::numeric, 0);
v_wallet_discount     := COALESCE((v_breakdown->>'wallet_discount')::numeric, 0);
v_promo_id            := NULLIF(v_breakdown->>'promo_id', '')::uuid;
v_promo_type          := v_breakdown->>'promo_type';
v_promo_discount      := COALESCE((v_breakdown->>'promo_discount')::numeric, 0);
v_promo_grupos_con    := COALESCE((v_breakdown->>'promo_grupos_con')::integer, 0);

-- ---- INCREMENT tour_promotions.times_used WHEN THE PROMO ACTUALLY APPLIED ----
-- Efecto secundario (escritura): se queda aqui, no en calculate_booking_breakdown,
-- para que una futura llamada de solo vista previa no gaste usos de la promocion.
IF v_promo_id IS NOT NULL AND v_promo_discount > 0 THEN
UPDATE public.tour_promotions
SET times_used = times_used + (CASE WHEN v_promo_type = 'nxprecio' THEN GREATEST(v_promo_grupos_con, 1) ELSE 1 END)
WHERE id = v_promo_id;
END IF;

-- ---- INSERT BOOKING ----
BEGIN
INSERT INTO bookings (
user_id, tour_id, agency_id, travelers_count, paid_spots, total_price,
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
initial_payment_amount, amount_due_now,
used_membership_benefit, membership_service_fee_saved
)
VALUES (
v_user_id,
v_tour_id,
v_agency_id,
v_travelers_count,
v_paid_spots,
(v_breakdown->>'base_tour_price_discounted')::numeric,
(v_breakdown->>'deposit_amount')::numeric,
(v_breakdown->>'commission_amount')::numeric,
v_deposit_sc,
v_amount_to_charge,
(v_breakdown->>'platform_revenue')::numeric,
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
(v_breakdown->>'discount_amount')::numeric,
COALESCE((p_booking_data->>'service_charge_discount')::numeric, 0),
p_booking_data->>'payment_provider',
NULLIF(p_booking_data->>'conekta_method', '')::text,
v_promo_id,
v_promo_discount,
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
(v_breakdown->>'insurance_cost')::numeric,
NULLIF((v_breakdown->>'insurance_days')::integer, 0),
NULLIF(p_booking_data->>'insurance_discount_code_id', '')::uuid,
COALESCE((p_booking_data->>'insurance_discount_amount')::numeric, 0),
COALESCE(p_booking_data->>'selected_payment_mode', 'standard'),
COALESCE((p_booking_data->>'membership_purchased')::boolean, false),
NULLIF(p_booking_data->>'membership_plan', '')::text,
(v_breakdown->>'membership_cost')::numeric,
v_amount_to_charge,
v_amount_to_charge,
COALESCE((v_breakdown->>'has_membership')::boolean, false) OR COALESCE((p_booking_data->>'membership_purchased')::boolean, false),
(v_breakdown->>'total_exemption')::numeric
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
WHEN v_cat = 'adulto'         THEN COALESCE(v_tour.precio_adulto, v_tour.price, 0) * v_preventa_ratio
WHEN v_cat = 'nino'           THEN COALESCE(v_tour.precio_nino, v_tour.price, 0) * v_preventa_ratio
WHEN v_cat = 'infante'        THEN COALESCE(v_tour.precio_infante, 0) * v_preventa_ratio
WHEN v_cat = 'adulto_mayor'   THEN COALESCE(v_tour.precio_adulto_mayor, v_tour.price, 0) * v_preventa_ratio
WHEN v_cat = 'mascota'        THEN COALESCE(v_tour.precio_mascota, 0)
ELSE COALESCE(v_tour.price, 0) * v_preventa_ratio
END;

INSERT INTO booking_travelers (
booking_id, nombre, apellido, email, telefono,
fecha_nacimiento, documento_tipo, documento_numero,
categoria_viajero, precio_aplicado,
emergency_contact_name, emergency_contact_phone, sexo
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
NULLIF(v_traveler->>'emergency_contact_phone', '')::text,
CASE WHEN v_traveler->>'sexo' IN ('masculino', 'femenino', 'no_binario')
     THEN v_traveler->>'sexo' ELSE NULL END
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

v_svc_sc := v_svc_subtotal * v_service_charge_rate;

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

RETURN jsonb_build_object(
'success', true,
'booking_id', v_booking_id,
'points_applied', ROUND(v_points_discount * 100)::integer,
'points_discount_mxn', v_points_discount,
'toursred_cash_applied', v_wallet_discount,
'total_price', (v_breakdown->>'base_tour_price_discounted')::numeric,
'deposit_amount', (v_breakdown->>'deposit_amount')::numeric,
'amount_to_charge', v_amount_to_charge,
'due_now', (v_breakdown->>'due_now')::numeric,
'deposit_pct', (v_breakdown->>'deposit_pct')::numeric,
'plan_initial_pct', (v_breakdown->>'plan_initial_pct')::numeric,
'service_charge', v_deposit_sc,
'is_full_wallet', COALESCE((v_breakdown->>'is_full_wallet')::boolean, false),
'promo_discount_amount', v_promo_discount,
'paid_spots', v_paid_spots
);
END;
$function$
;
