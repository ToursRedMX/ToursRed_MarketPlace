-- Dos tipos de codigo de descuento nunca bajaban lo que de verdad se cobra,
-- encontrado armando la Parte B de centralizar costos (preview_booking_breakdown,
-- PR #413): `service_fee_*` (baja el cargo por servicio) y `insurance_*` (baja
-- el seguro de viaje). src/utils/descuentoDeReserva.ts ya documentaba los tres
-- destinos posibles de un descuento, y el front SI calculaba y MOSTRABA estos
-- dos -- pero create_booking_atomic solo aplicaba el tipo que baja el PRECIO
-- DEL TOUR (tour_percentage/agency_tour_percentage/tour_fixed/agency_tour_fixed).
-- Los otros dos nunca entraban al calculo de amount_to_charge: el total que
-- veia el viajero en pantalla era mas bajo que lo que de verdad se le cobraba
-- via Stripe/PayPal/etc. BookingForm.tsx manda los mismos campos a la misma
-- RPC, asi que tenia el mismo hueco -- no es que ahi si funcionara.
--
-- Se corrige en el servidor, no en el front: calculate_booking_breakdown ahora
-- calcula los tres tipos con la MISMA formula que ya tenia
-- descuentoDeCargoPorServicio/descuentoDeSeguro (service_fee_full/percentage/fixed,
-- insurance_free/percentage/fixed, ambos con su propio tope de max_discount_amount),
-- y los resta de v_base_service_charge / v_insurance_cost ANTES de que el resto
-- del calculo (exencion de membresia, due_now, amount_to_charge) los use. De
-- paso, create_booking_atomic deja de confiar en p_booking_data->>'service_charge_discount'
-- / 'insurance_discount_amount' (lo que mandaba el cliente, sin validar) y usa
-- lo que el propio servidor acaba de calcular.
--
-- Orden elegido: el descuento de cargo por servicio se aplica ANTES de la
-- cascada de exencion de membresia (seccion 5) -- mismo orden que ya usaba el
-- descuento de precio del tour sobre el precio antes del cargo por servicio
-- (seccion 3 antes de la 4). No se investigo si un viajero puede tener a la
-- vez un codigo de este tipo y membresia activa en los datos de hoy; si se da
-- el caso, los dos descuentos se suman en cascada (codigo primero, exencion
-- despues sobre el remanente), nunca se superan entre si ni bajan de cero.
--
-- Lo que NO se toca: el registro de uso (discount_code_usage) para estos dos
-- tipos. Hoy solo lo escribe stripe-webhook, al confirmarse el pago -- el
-- mismo patron (o su ausencia) que ya tenia el descuento de precio del tour,
-- y no es lo que se pidio corregir aqui.

CREATE OR REPLACE FUNCTION public.calculate_booking_breakdown(
  p_tour_id uuid,
  p_user_id uuid,
  p_booking_data jsonb,
  p_travelers jsonb,
  p_optional_services jsonb,
  p_paid_spots integer,
  p_travelers_count integer,
  p_consume_exemption boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_tour                     record;
v_rates                    record;
v_agency_id                uuid;

v_base_tour_price          numeric := 0;
v_base_tour_price_discounted numeric := 0;
v_extras_subtotal          numeric := 0;
v_extras_sc_base           numeric := 0;
v_base_service_charge      numeric := 0;
v_deposit_sc               numeric := 0;
v_extras_sc                numeric := 0;
v_exemption_result         json;
v_base_exemption           numeric := 0;
v_extras_exemption         numeric := 0;
v_total_exemption          numeric := 0;
v_has_membership           boolean := false;
v_is_high_risk             boolean := false;
v_membership_still_valid   boolean := false;
v_points_wallet_active     boolean := false;
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
v_grand_total               numeric := 0;
v_deposit_pct               numeric := 50;
v_deposit_amount            numeric := 0;
v_amount_to_charge          numeric := 0;
v_due_now                   numeric := 0;
v_inst                      jsonb;
v_inst_due_date             date;
v_departure_date            date;
v_plan_initial_pct          numeric := 0;
v_is_full_wallet            boolean := false;
v_net_before_charges        numeric := 0;
v_max_points_allowed        numeric := 0;
v_commission_amount         numeric := 0;
v_platform_revenue          numeric := 0;
v_discount_rec               record;
v_discount_code_found        boolean := false;
v_promo_id                  uuid;
v_promo_type                 text;
v_promo_min_travelers        integer;
v_promo_group_size           integer;
v_promo_pay_count            integer;
v_promo_fixed_group_price    numeric;
v_promo_discount_pct         numeric;
v_promo_max_uses             integer;
v_promo_times_used           integer;
v_promo_discount             numeric := 0;
v_cnt_adulto                 integer := 0;
v_cnt_nino                   integer := 0;
v_cnt_infante                integer := 0;
v_cnt_adulto_mayor            integer := 0;
v_humanos                    integer := 0;
v_promo_grupos               integer := 0;
v_promo_usos_restantes       integer := 0;
v_promo_grupos_con           integer := 0;
v_promo_precio_adulto        numeric := 0;
v_promo_precio_nino          numeric := 0;
v_promo_precio_infante       numeric := 0;
v_promo_precio_adulto_mayor  numeric := 0;
v_preventa_ratio             numeric := 1;
v_es_per_vehicle             boolean := false;

v_pickup_zone_name     text;
v_selected_language    text;
v_pickup_zone_elem     jsonb;
v_language_elem        jsonb;
v_pickup_zone_cost     numeric := 0;
v_language_cost        numeric := 0;
v_pickup_cost_type     text;
v_language_cost_type   text;

v_traveler        jsonb;
v_traveler_price   numeric;
v_cat              text;

v_service        jsonb;
v_svc_id          uuid;
v_svc_qty         integer;
v_svc_unit        numeric;
v_svc_subtotal    numeric;
v_svc_sc          numeric;
v_svc_kind        text;

-- Solo para el camino p_consume_exemption = false (vista previa): misma
-- formula que apply_membership_service_fee_exemption, pero sin UPDATE.
v_peek_monthly_limit  numeric;
v_peek_used           numeric;
v_peek_reset          timestamptz;
v_peek_available      numeric;
v_peek_found          boolean;

-- Descuentos de cargo por servicio y de seguro (esta migracion).
v_service_fee_discount_amount numeric := 0;
v_insurance_discount_amount   numeric := 0;
v_insurance_discount_code_id  uuid;
v_ins_discount_rec            record;
BEGIN
v_membership_purchased := COALESCE((p_booking_data->>'membership_purchased')::boolean, false);
v_pickup_zone_name := NULLIF(p_booking_data->>'pickup_zone_name', '')::text;
v_selected_language := NULLIF(p_booking_data->>'selected_language', '')::text;

IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
RETURN jsonb_build_object('success', false, 'error', 'No autorizado: el user_id no coincide con la sesion autenticada');
END IF;

SELECT
t.id, t.agency_id, t.price, t.precio_adulto, t.precio_nino, t.precio_infante,
t.precio_adulto_mayor, t.precio_mascota, t.deposit_percentage, t.payment_option,
t.payment_plan_mode, t.installment_definitions, t.start_date, t.end_date, t.tour_type,
t.pickup_zones, t.tour_languages, t.preventa_precio_especial, t.preventa_tipo_descuento,
t.preventa_descuento_valor, t.activity_type, t.receptivo_modality, t.transfer_pricing_mode,
t.min_travelers_required, t.politica_bajo_minimo
INTO v_tour
FROM tours t
WHERE t.id = p_tour_id;

IF v_tour IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Tour no encontrado');
END IF;

v_agency_id := v_tour.agency_id;

IF COALESCE((p_booking_data->>'es_reserva_preventa')::boolean, false)
   AND v_tour.preventa_precio_especial
   AND v_tour.preventa_descuento_valor IS NOT NULL
   AND v_tour.preventa_descuento_valor > 0 THEN
  IF v_tour.preventa_tipo_descuento = 'porcentaje' THEN
    v_preventa_ratio := GREATEST(0, 1 - v_tour.preventa_descuento_valor / 100);
  ELSIF v_tour.price > 0 THEN
    v_preventa_ratio := GREATEST(0, v_tour.price - v_tour.preventa_descuento_valor) / v_tour.price;
  END IF;
END IF;

v_es_per_vehicle := (
  v_tour.activity_type = 'transport'
  AND v_tour.receptivo_modality = 'privado'
  AND v_tour.transfer_pricing_mode = 'per_vehicle'
);

SELECT * INTO v_rates
FROM public.get_effective_commission_rates(v_agency_id, p_tour_id);

-- ---- 1. RECALCULATE BASE TOUR PRICE FROM REAL PER-CATEGORY PRICES ----
IF p_travelers IS NOT NULL AND jsonb_array_length(p_travelers) > 0 THEN
FOR v_traveler IN SELECT jsonb_array_elements(p_travelers) LOOP
v_cat := COALESCE(v_traveler->>'categoria_viajero', 'adulto');
v_traveler_price := CASE
WHEN v_cat = 'adulto'         THEN COALESCE(v_tour.precio_adulto, v_tour.price, 0) * v_preventa_ratio
WHEN v_cat = 'nino'           THEN COALESCE(v_tour.precio_nino, v_tour.price, 0) * v_preventa_ratio
WHEN v_cat = 'infante'        THEN COALESCE(v_tour.precio_infante, 0) * v_preventa_ratio
WHEN v_cat = 'adulto_mayor'   THEN COALESCE(v_tour.precio_adulto_mayor, v_tour.price, 0) * v_preventa_ratio
WHEN v_cat = 'mascota'        THEN COALESCE(v_tour.precio_mascota, 0)
ELSE COALESCE(v_tour.price, 0) * v_preventa_ratio
END;
v_base_tour_price := v_base_tour_price + v_traveler_price;
IF v_cat = 'adulto' THEN v_cnt_adulto := v_cnt_adulto + 1;
ELSIF v_cat = 'nino' THEN v_cnt_nino := v_cnt_nino + 1;
ELSIF v_cat = 'infante' THEN v_cnt_infante := v_cnt_infante + 1;
ELSIF v_cat = 'adulto_mayor' THEN v_cnt_adulto_mayor := v_cnt_adulto_mayor + 1;
END IF;
END LOOP;
END IF;

-- ---- 1.1 PRECIO FIJO POR VEHICULO O LUGARES EXTRA DE GARANTIA DE SALIDA ----
IF v_es_per_vehicle THEN
  v_base_tour_price := COALESCE(v_tour.precio_adulto, v_tour.price, 0) * v_preventa_ratio;
ELSIF p_paid_spots > p_travelers_count THEN
  v_base_tour_price := v_base_tour_price
    + (p_paid_spots - p_travelers_count) * COALESCE(v_tour.precio_adulto, v_tour.price, 0) * v_preventa_ratio;
END IF;

-- ---- 1.5 GROUP PROMOTION (portado de src/utils/promocionDeGrupo.ts) ----
v_humanos := v_cnt_adulto + v_cnt_nino + v_cnt_infante + v_cnt_adulto_mayor;

SELECT tp.id, tp.promotion_type::text, tp.min_travelers, tp.group_size, tp.pay_count,
tp.fixed_group_price, tp.group_discount_percentage, tp.max_uses, tp.times_used
INTO v_promo_id, v_promo_type, v_promo_min_travelers, v_promo_group_size, v_promo_pay_count,
v_promo_fixed_group_price, v_promo_discount_pct, v_promo_max_uses, v_promo_times_used
FROM tour_promotions tp
WHERE tp.tour_id = p_tour_id
AND tp.is_active = true
AND (tp.valid_from IS NULL OR tp.valid_from::date <= CURRENT_DATE)
AND (tp.valid_until IS NULL OR tp.valid_until::date >= CURRENT_DATE)
AND (tp.max_uses IS NULL OR tp.times_used < tp.max_uses)
ORDER BY tp.created_at DESC
LIMIT 1;

v_promo_precio_adulto := COALESCE(v_tour.precio_adulto, v_tour.price, 0);
v_promo_precio_nino := COALESCE(v_tour.precio_nino, 0);
v_promo_precio_infante := COALESCE(v_tour.precio_infante, 0);
v_promo_precio_adulto_mayor := COALESCE(v_tour.precio_adulto_mayor, v_tour.precio_adulto, v_tour.price, 0);

IF v_promo_type = 'nxprecio' AND v_promo_min_travelers IS NOT NULL AND v_promo_min_travelers > 0
AND v_humanos >= v_promo_min_travelers AND v_promo_fixed_group_price IS NOT NULL THEN
v_promo_grupos := FLOOR(v_humanos::numeric / v_promo_min_travelers);
v_promo_usos_restantes := CASE WHEN v_promo_max_uses IS NOT NULL
THEN GREATEST(0, v_promo_max_uses - v_promo_times_used)
ELSE v_promo_grupos END;
v_promo_grupos_con := LEAST(v_promo_grupos, v_promo_usos_restantes);
v_promo_discount := ROUND(
v_promo_grupos_con * GREATEST(0, (v_promo_min_travelers * v_promo_precio_adulto) - v_promo_fixed_group_price),
2
);

ELSIF v_promo_type = 'grupo_precio_fijo' AND v_promo_min_travelers IS NOT NULL
AND v_humanos >= v_promo_min_travelers
AND v_promo_discount_pct IS NOT NULL AND v_promo_discount_pct > 0 THEN
v_promo_discount := ROUND(
(v_promo_precio_adulto * v_cnt_adulto
+ v_promo_precio_nino * v_cnt_nino
+ v_promo_precio_infante * v_cnt_infante
+ v_promo_precio_adulto_mayor * v_cnt_adulto_mayor) * (v_promo_discount_pct / 100),
2
);

ELSIF v_promo_type IN ('2x1', '3x2') AND v_promo_group_size IS NOT NULL AND v_promo_pay_count IS NOT NULL
AND v_humanos >= v_promo_group_size AND (v_promo_group_size - v_promo_pay_count) > 0 THEN
v_promo_discount := ROUND(
FLOOR(v_humanos::numeric / v_promo_group_size) * (v_promo_group_size - v_promo_pay_count) * v_promo_precio_adulto,
2
);
END IF;

v_promo_discount := GREATEST(0, LEAST(v_promo_discount, v_base_tour_price));

-- ---- PRE-COMPUTE PICKUP & LANGUAGE REAL COSTS FROM TOUR DATA ----
v_pickup_zone_cost := 0;
v_pickup_cost_type := NULL;
IF v_pickup_zone_name IS NOT NULL AND v_tour.pickup_zones IS NOT NULL THEN
FOR v_pickup_zone_elem IN SELECT jsonb_array_elements(v_tour.pickup_zones) LOOP
IF v_pickup_zone_elem->>'name' = v_pickup_zone_name THEN
v_pickup_cost_type := COALESCE(v_pickup_zone_elem->>'cost_type', 'por_persona');
IF v_pickup_cost_type = 'por_persona' THEN
v_pickup_zone_cost := COALESCE((v_pickup_zone_elem->>'extra_cost')::numeric, 0) * p_travelers_count;
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
v_language_cost := COALESCE((v_language_elem->>'extra_cost')::numeric, 0) * p_travelers_count;
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
-- v_discount_rec se reusa mas abajo (despues de la 4) para el descuento de
-- cargo por servicio -- necesita v_base_service_charge, que aun no existe
-- aqui. v_discount_code_found evita tocar v_discount_rec sin asignar si el
-- codigo no se encontro.
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
v_discount_code_found := true;
IF v_discount_rec.discount_type IN ('tour_percentage', 'agency_tour_percentage') THEN
v_discount_amount := GREATEST(0, v_base_tour_price - v_promo_discount)
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
v_discount_code_found := false;
END;
END IF;

-- ---- 4. CALCULATE DISCOUNTED TOUR PRICE AND BASE SERVICE CHARGE ----
v_base_tour_price_discounted := GREATEST(0, v_base_tour_price - v_promo_discount - v_discount_amount);
v_base_service_charge := ROUND(v_base_tour_price_discounted * v_rates.service_charge_rate, 2);

-- ---- 4.5 DESCUENTO DE CARGO POR SERVICIO (mismo codigo que la 3, mismas
-- formulas que descuentoDeCargoPorServicio en src/utils/descuentoDeReserva.ts)
-- ----
IF v_discount_code_found AND v_discount_rec.discount_type IN ('service_fee_full', 'service_fee_percentage', 'service_fee_fixed') THEN
CASE v_discount_rec.discount_type
WHEN 'service_fee_full' THEN
v_service_fee_discount_amount := v_base_service_charge;
WHEN 'service_fee_percentage' THEN
v_service_fee_discount_amount := v_base_service_charge * (COALESCE(v_discount_rec.discount_value, 0) / 100);
WHEN 'service_fee_fixed' THEN
v_service_fee_discount_amount := COALESCE(v_discount_rec.discount_value, 0);
END CASE;
IF v_discount_rec.max_discount_amount IS NOT NULL THEN
v_service_fee_discount_amount := LEAST(v_service_fee_discount_amount, v_discount_rec.max_discount_amount);
END IF;
v_service_fee_discount_amount := ROUND(LEAST(GREATEST(v_service_fee_discount_amount, 0), v_base_service_charge), 2);
v_base_service_charge := v_base_service_charge - v_service_fee_discount_amount;
END IF;

-- ---- 5. MEMBERSHIP EXEMPTION CASCADE ----
v_has_membership := public.has_active_membership(p_user_id);

IF v_membership_purchased THEN
v_deposit_sc := 0;
v_extras_sc := 0;
v_base_exemption := v_base_service_charge;
v_extras_exemption := v_extras_sc_base;
ELSIF v_has_membership THEN
IF p_consume_exemption THEN
v_exemption_result := public.apply_membership_service_fee_exemption(p_user_id, v_base_service_charge);
v_base_exemption := COALESCE((v_exemption_result->>'exemption_applied')::numeric, 0);
v_deposit_sc := COALESCE((v_exemption_result->>'net_service_charge')::numeric, v_base_service_charge - v_base_exemption);

v_exemption_result := public.apply_membership_service_fee_exemption(p_user_id, v_extras_sc_base);
v_extras_exemption := COALESCE((v_exemption_result->>'exemption_applied')::numeric, 0);
v_extras_sc := COALESCE((v_exemption_result->>'net_service_charge')::numeric, v_extras_sc_base - v_extras_exemption);
ELSE
-- Vista previa: misma formula que apply_membership_service_fee_exemption,
-- sin UPDATE ni FOR UPDATE. El acumulado entre deposito y extras se lleva
-- en variables locales (v_peek_available), no releyendo la base, para
-- igualar el comportamiento secuencial de las dos llamadas reales de
-- arriba dentro de esta misma invocacion.
SELECT COALESCE(membership_service_fee_exemption_monthly_limit, 500)
INTO v_peek_monthly_limit
FROM platform_settings LIMIT 1;
IF v_peek_monthly_limit IS NULL THEN v_peek_monthly_limit := 500; END IF;

SELECT true, service_fee_exemption_used, service_fee_exemption_reset_date
INTO v_peek_found, v_peek_used, v_peek_reset
FROM memberships
WHERE user_id = p_user_id
AND status <> 'expired'
AND current_period_end > now()
ORDER BY current_period_end DESC
LIMIT 1;

IF NOT v_peek_found THEN
v_base_exemption := 0;
v_deposit_sc := v_base_service_charge;
v_extras_exemption := 0;
v_extras_sc := v_extras_sc_base;
ELSE
IF now() >= v_peek_reset THEN
v_peek_used := 0;
END IF;
v_peek_available := GREATEST(0, v_peek_monthly_limit - COALESCE(v_peek_used, 0));

v_base_exemption := LEAST(v_peek_available, v_base_service_charge);
v_deposit_sc := v_base_service_charge - v_base_exemption;
v_peek_available := v_peek_available - v_base_exemption;

v_extras_exemption := LEAST(v_peek_available, v_extras_sc_base);
v_extras_sc := v_extras_sc_base - v_extras_exemption;
END IF;
END IF;
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

v_insurance_cost := v_insurance_price_day * v_insurance_days * p_travelers_count;

-- ---- 6.5 DESCUENTO DE SEGURO (mismas formulas que descuentoDeSeguro en
-- src/utils/descuentoDeReserva.ts). Codigo DISTINTO al de arriba
-- (insurance_discount_code_id, no discount_code_id) y misma tabla
-- discount_codes -- validate_insurance_discount_code solo filtra por
-- applicable_to='insurance', asi que aqui se filtra por discount_type.
v_insurance_discount_code_id := NULLIF(p_booking_data->>'insurance_discount_code_id', '')::uuid;
IF v_insurance_discount_code_id IS NOT NULL AND v_insurance_cost > 0 THEN
BEGIN
SELECT discount_type, discount_value, max_discount_amount
INTO v_ins_discount_rec
FROM discount_codes
WHERE id = v_insurance_discount_code_id
AND is_active = true
AND (valid_until IS NULL OR valid_until > now())
AND (max_uses IS NULL OR times_used < max_uses);

IF FOUND THEN
CASE v_ins_discount_rec.discount_type
WHEN 'insurance_free' THEN
v_insurance_discount_amount := v_insurance_cost;
WHEN 'insurance_percentage' THEN
v_insurance_discount_amount := v_insurance_cost * (COALESCE(v_ins_discount_rec.discount_value, 0) / 100);
WHEN 'insurance_fixed' THEN
v_insurance_discount_amount := COALESCE(v_ins_discount_rec.discount_value, 0);
ELSE
v_insurance_discount_amount := 0;
END CASE;
IF v_ins_discount_rec.max_discount_amount IS NOT NULL THEN
v_insurance_discount_amount := LEAST(v_insurance_discount_amount, v_ins_discount_rec.max_discount_amount);
END IF;
v_insurance_discount_amount := ROUND(LEAST(GREATEST(v_insurance_discount_amount, 0), v_insurance_cost), 2);
v_insurance_cost := v_insurance_cost - v_insurance_discount_amount;
END IF;
EXCEPTION WHEN OTHERS THEN
v_insurance_discount_amount := 0;
END;
END IF;
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

-- ---- 7.5 ALTO RIESGO Y VIGENCIA DE MEMBRESIA (para puntos, abajo) ----
v_is_high_risk := public.is_high_risk_traveler(p_user_id);

SELECT EXISTS (
SELECT 1 FROM memberships
WHERE user_id = p_user_id
AND (status = 'active' OR (status = 'cancelled' AND current_period_end > now()))
) INTO v_membership_still_valid;

-- ---- 8. DEPOSIT BASE, POINTS AND WALLET VALIDATION ----
IF v_is_high_risk THEN
v_deposit_pct := 100;
ELSE
v_deposit_pct := CASE
WHEN COALESCE(v_tour.payment_option, 'standard') = 'full_upfront' THEN 100
ELSE COALESCE(v_tour.deposit_percentage, 50)
END;

IF COALESCE(v_tour.payment_option, 'standard') = 'payment_plan'
AND COALESCE(v_tour.payment_plan_mode, 'installments') = 'installments'
AND jsonb_typeof(v_tour.installment_definitions) = 'array' THEN

v_departure_date := COALESCE(
NULLIF(p_booking_data->>'selected_date', '')::date,
v_tour.start_date::date
);
v_plan_initial_pct := 0;

FOR v_inst IN SELECT jsonb_array_elements(v_tour.installment_definitions) LOOP
v_inst_due_date := NULL;

IF (v_inst->>'days_after_booking') IS NOT NULL THEN
v_inst_due_date := CURRENT_DATE + COALESCE((v_inst->>'days_after_booking')::integer, 0);
ELSIF (v_inst->>'days_before_departure') IS NOT NULL AND v_departure_date IS NOT NULL THEN
v_inst_due_date := v_departure_date - COALESCE((v_inst->>'days_before_departure')::integer, 0);
ELSIF NULLIF(v_inst->>'specific_date', '') IS NOT NULL THEN
v_inst_due_date := (v_inst->>'specific_date')::date;
END IF;

IF v_inst_due_date IS NOT NULL AND v_inst_due_date <= CURRENT_DATE THEN
v_plan_initial_pct := v_plan_initial_pct + COALESCE((v_inst->>'pct_of_total')::numeric, 0);
END IF;
END LOOP;

IF v_plan_initial_pct > 0 THEN
v_deposit_pct := LEAST(100, v_plan_initial_pct);
END IF;
END IF;
END IF;

v_deposit_amount := ROUND(v_base_tour_price_discounted * (v_deposit_pct / 100), 2);

v_net_before_charges := GREATEST(0, v_deposit_amount
+ v_extras_subtotal + v_insurance_cost + v_membership_cost);

IF COALESCE((p_booking_data->>'points_used')::integer, 0) > 0 THEN
SELECT COALESCE(balance, 0), COALESCE(is_active, false) INTO v_points_balance, v_points_wallet_active
FROM toursred_points_wallets
WHERE user_id = p_user_id
LIMIT 1;

IF v_points_wallet_active OR v_membership_still_valid THEN
v_max_points_allowed := FLOOR(v_net_before_charges * 100 * 0.5);

v_points_discount := LEAST(
COALESCE((p_booking_data->>'points_used')::integer, 0),
v_points_balance,
v_max_points_allowed
) / 100.0;
ELSE
v_points_discount := 0;
END IF;
END IF;

IF COALESCE((p_booking_data->>'toursred_cash_used')::numeric, 0) > 0 THEN
SELECT COALESCE(balance, 0) INTO v_wallet_balance
FROM toursred_cash_wallets
WHERE user_id = p_user_id AND is_active = true
LIMIT 1;
v_wallet_discount := LEAST(
COALESCE((p_booking_data->>'toursred_cash_used')::numeric, 0),
v_wallet_balance,
GREATEST(0, v_net_before_charges - v_points_discount)
);
END IF;

-- ---- 9. ASSEMBLE TOTALS ----
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

v_due_now := v_deposit_amount
+ v_deposit_sc
+ v_extras_subtotal
+ v_extras_sc
+ v_insurance_cost
+ v_membership_cost;

v_amount_to_charge := GREATEST(0, ROUND(v_due_now - v_points_discount - v_wallet_discount, 2));
IF v_amount_to_charge > 0 AND v_amount_to_charge < 10 THEN
v_amount_to_charge := 0;
END IF;

v_commission_amount := ROUND(v_base_tour_price * v_rates.agency_commission_rate, 2);
v_platform_revenue := v_deposit_sc + v_extras_sc;

RETURN jsonb_build_object(
'success', true,
'preventa_ratio', v_preventa_ratio,
'es_per_vehicle', v_es_per_vehicle,
'base_tour_price', v_base_tour_price,
'base_tour_price_discounted', v_base_tour_price_discounted,
'extras_subtotal', v_extras_subtotal,
'extras_sc_base', v_extras_sc_base,
'extras_sc', v_extras_sc,
'extras_exemption', v_extras_exemption,
'base_service_charge', v_base_service_charge,
'deposit_sc', v_deposit_sc,
'base_exemption', v_base_exemption,
'total_exemption', v_total_exemption,
'has_membership', v_has_membership,
'is_high_risk', v_is_high_risk,
'membership_still_valid', v_membership_still_valid,
'membership_cost', v_membership_cost,
'insurance_cost', v_insurance_cost,
'insurance_days', v_insurance_days,
'discount_amount', v_discount_amount,
'service_charge_discount_amount', v_service_fee_discount_amount,
'insurance_discount_amount', v_insurance_discount_amount,
'promo_id', v_promo_id,
'promo_type', v_promo_type,
'promo_discount', v_promo_discount,
'promo_grupos_con', v_promo_grupos_con,
'deposit_pct', v_deposit_pct,
'deposit_amount', v_deposit_amount,
'plan_initial_pct', v_plan_initial_pct,
'points_balance', v_points_balance,
'points_wallet_active', v_points_wallet_active,
'points_discount', v_points_discount,
'max_points_allowed', v_max_points_allowed,
'wallet_balance', v_wallet_balance,
'wallet_discount', v_wallet_discount,
'is_full_wallet', v_is_full_wallet,
'subtotal', v_subtotal,
'grand_total', v_grand_total,
'due_now', v_due_now,
'amount_to_charge', v_amount_to_charge,
'commission_amount', v_commission_amount,
'platform_revenue', v_platform_revenue,
'pickup_zone_cost', v_pickup_zone_cost,
'pickup_cost_type', v_pickup_cost_type,
'language_cost', v_language_cost,
'language_cost_type', v_language_cost_type,
'service_charge_rate', v_rates.service_charge_rate,
'agency_commission_rate', v_rates.agency_commission_rate
);
END;
$function$;

-- create_booking_atomic ya no confia en lo que el cliente mando para estos dos
-- campos -- usa lo que el servidor acaba de calcular arriba.
CREATE OR REPLACE FUNCTION public.create_booking_atomic(p_booking_data jsonb, p_travelers jsonb DEFAULT '[]'::jsonb, p_optional_services jsonb DEFAULT '[]'::jsonb, p_session_id text DEFAULT NULL::text, p_seat_numbers integer[] DEFAULT NULL::integer[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_user_id           uuid    := (p_booking_data->>'user_id')::uuid;
v_tour_id           uuid    := (p_booking_data->>'tour_id')::uuid;
v_agency_id         uuid    := v_tour_id;
v_slot_id           uuid    := NULL;
v_travelers_count   integer := (p_booking_data->>'travelers_count')::integer;
v_booking_id        uuid;

v_tour              record;

v_slot              record;
v_max_capacity      integer;
v_total_booked      integer;
v_blocked           integer;
v_held              integer;
v_available         integer;

v_es_per_vehicle           boolean := false;
v_paid_spots               integer := 0;
v_missing_for_slot         integer := 0;

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

v_traveler        jsonb;
v_traveler_price  numeric;
v_cat             text;
v_doc_tipo        text;
v_doc_numero      text;

v_service         jsonb;
v_svc_id          uuid;
v_svc_qty         integer;
v_svc_unit        numeric;
v_svc_subtotal    numeric;
v_svc_sc          numeric;
v_svc_kind        text;
v_svc_exemption   numeric;
v_svc_net_sc      numeric;

v_seat  integer;
v_rows  integer;
BEGIN
v_slot_id := NULLIF(p_booking_data->>'slot_id', '')::uuid;

IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM v_user_id THEN
RETURN jsonb_build_object('success', false, 'error', 'No autorizado: el user_id no coincide con la sesion autenticada');
END IF;

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

v_agency_id := v_tour.agency_id;

v_es_per_vehicle := (
  v_tour.activity_type = 'transport'
  AND v_tour.receptivo_modality = 'privado'
  AND v_tour.transfer_pricing_mode = 'per_vehicle'
);

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

IF v_promo_id IS NOT NULL AND v_promo_discount > 0 THEN
UPDATE public.tour_promotions
SET times_used = times_used + (CASE WHEN v_promo_type = 'nxprecio' THEN GREATEST(v_promo_grupos_con, 1) ELSE 1 END)
WHERE id = v_promo_id;
END IF;

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
COALESCE((v_breakdown->>'service_charge_discount_amount')::numeric, 0),
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
COALESCE((v_breakdown->>'insurance_discount_amount')::numeric, 0),
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
$function$;
