
-- 1. calculate_preventa_precio
CREATE OR REPLACE FUNCTION public.calculate_preventa_precio(
  p_tour_id uuid,
  p_precio_base numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_precio_especial boolean;
v_tipo_descuento text;
v_descuento_valor decimal;
v_precio_final decimal;
BEGIN
SELECT preventa_precio_especial, preventa_tipo_descuento, preventa_descuento_valor
INTO v_precio_especial, v_tipo_descuento, v_descuento_valor
FROM tours
WHERE id = p_tour_id;

IF NOT v_precio_especial OR v_descuento_valor IS NULL OR v_descuento_valor <= 0 THEN
RETURN p_precio_base;
END IF;

IF v_tipo_descuento = 'monto' THEN
v_precio_final := GREATEST(0, p_precio_base - v_descuento_valor);
ELSIF v_tipo_descuento = 'porcentaje' THEN
v_precio_final := p_precio_base * (1 - (v_descuento_valor / 100));
ELSE
v_precio_final := p_precio_base;
END IF;

RETURN v_precio_final;
END;
$$;

-- 2. calculate_transaction_breakdown
CREATE OR REPLACE FUNCTION public.calculate_transaction_breakdown(
  p_transaction_type text,
  p_total_price numeric,
  p_commission_rate numeric,
  p_service_charge_rate numeric,
  p_cancellation_policy text DEFAULT NULL::text
)
RETURNS TABLE(gross_amount numeric, platform_commission numeric, net_to_agency numeric, platform_revenue numeric)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_agency_commission numeric;
v_service_charge numeric;
v_refund_percentage numeric DEFAULT 0;
v_amount_after_refund numeric;
BEGIN
v_agency_commission := p_total_price * p_commission_rate;
v_service_charge := p_total_price * p_service_charge_rate;

CASE p_transaction_type
WHEN 'booking' THEN
gross_amount := p_total_price;
platform_commission := v_agency_commission + v_service_charge;
net_to_agency := p_total_price - platform_commission;
platform_revenue := platform_commission;
WHEN 'cancellation_full' THEN
gross_amount := p_total_price;
platform_commission := CASE
WHEN p_cancellation_policy = 'pending_approval' THEN v_agency_commission + v_service_charge
ELSE v_service_charge
END;
net_to_agency := 0;
platform_revenue := platform_commission;
WHEN 'cancellation_partial' THEN
v_refund_percentage := 0.50;
v_amount_after_refund := p_total_price * (1 - v_refund_percentage);
gross_amount := v_amount_after_refund;
v_agency_commission := v_amount_after_refund * p_commission_rate;
v_service_charge := v_amount_after_refund * p_service_charge_rate;
platform_commission := v_agency_commission + v_service_charge;
net_to_agency := v_amount_after_refund - platform_commission;
platform_revenue := platform_commission;
WHEN 'no_show' THEN
gross_amount := p_total_price;
platform_commission := v_agency_commission + v_service_charge;
net_to_agency := p_total_price - platform_commission;
platform_revenue := platform_commission;
WHEN 'tour_cancellation_by_agency' THEN
gross_amount := p_total_price;
platform_commission := 0;
net_to_agency := 0;
platform_revenue := 0;
WHEN 'adjustment' THEN
gross_amount := p_total_price;
platform_commission := v_agency_commission + v_service_charge;
net_to_agency := p_total_price - platform_commission;
platform_revenue := platform_commission;
ELSE
RAISE EXCEPTION 'Unknown transaction type: %', p_transaction_type;
END CASE;

RETURN NEXT;
END;
$$;

-- 3. check_user_code_usage
CREATE OR REPLACE FUNCTION public.check_user_code_usage(
  p_code text,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_code_id uuid;
v_has_used boolean;
BEGIN
SELECT id INTO v_code_id
FROM public.discount_codes
WHERE UPPER(code) = UPPER(p_code);

IF v_code_id IS NULL THEN
RETURN false;
END IF;

SELECT EXISTS(
SELECT 1
FROM public.discount_code_usage
WHERE discount_code_id = v_code_id
AND user_id = p_user_id
) INTO v_has_used;

RETURN v_has_used;
END;
$$;

-- 4. get_active_promotion_for_tour
CREATE OR REPLACE FUNCTION public.get_active_promotion_for_tour(p_tour_id uuid)
RETURNS TABLE(id uuid, promotion_type text, min_travelers integer, group_size integer, pay_count integer, fixed_group_price numeric, group_discount_percentage numeric, valid_from date, valid_until date, max_uses integer, times_used integer, is_active boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
tp.id,
tp.promotion_type::text,
tp.min_travelers,
tp.group_size,
tp.pay_count,
tp.fixed_group_price,
tp.group_discount_percentage,
tp.valid_from::date,
tp.valid_until::date,
tp.max_uses,
tp.times_used,
tp.is_active
FROM tour_promotions tp
WHERE tp.tour_id = p_tour_id
AND tp.is_active = true
AND (tp.valid_from IS NULL OR tp.valid_from::date <= CURRENT_DATE)
AND (tp.valid_until IS NULL OR tp.valid_until::date >= CURRENT_DATE)
AND (tp.max_uses IS NULL OR tp.times_used < tp.max_uses)
ORDER BY tp.created_at DESC
LIMIT 1;
END;
$$;

-- 5. get_active_terms
CREATE OR REPLACE FUNCTION public.get_active_terms(p_type text)
RETURNS TABLE(id uuid, terms_type text, version_number integer, title text, content text, change_summary text, published_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
tv.id,
tv.terms_type,
tv.version_number,
tv.title,
tv.content,
tv.change_summary,
tv.published_at
FROM terms_versions tv
WHERE tv.terms_type = p_type
AND tv.is_active = true
LIMIT 1;
END;
$$;

-- 6. get_agency_reviews_with_users
CREATE OR REPLACE FUNCTION public.get_agency_reviews_with_users(p_agency_id uuid)
RETURNS TABLE(id uuid, agency_id uuid, traveler_id uuid, rating integer, comment text, reply text, created_at timestamptz, updated_at timestamptz, traveler_first_name text, traveler_last_name text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
ar.id,
ar.agency_id,
ar.traveler_id,
ar.rating,
ar.comment,
ar.reply,
ar.created_at,
ar.updated_at,
u.first_name,
u.last_name
FROM public.agency_reviews ar
LEFT JOIN public.users u ON u.id = ar.traveler_id
WHERE ar.agency_id = p_agency_id
AND ar.is_visible = true
ORDER BY ar.created_at DESC;
END;
$$;

-- 7. get_departure_location_suggestions
CREATE OR REPLACE FUNCTION public.get_departure_location_suggestions(
  search_text text,
  limit_results integer DEFAULT 10
)
RETURNS TABLE(id uuid, name text, address text, city text, state text, place_type text, tour_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
dl.id,
dl.name,
dl.address,
dl.city,
dl.state,
dl.place_type,
COUNT(DISTINCT tdl.tour_id) as tour_count
FROM departure_locations dl
LEFT JOIN tour_departure_locations tdl ON tdl.location_id = dl.id
WHERE
dl.is_active = true
AND (
dl.name ILIKE '%' || search_text || '%'
OR dl.address ILIKE '%' || search_text || '%'
OR dl.city ILIKE '%' || search_text || '%'
OR search_text = ANY(dl.aliases)
)
GROUP BY dl.id, dl.name, dl.address, dl.city, dl.state, dl.place_type
ORDER BY
COUNT(DISTINCT tdl.tour_id) DESC,
dl.name ASC
LIMIT limit_results;
END;
$$;

-- 8. get_optional_service_available_capacity
CREATE OR REPLACE FUNCTION public.get_optional_service_available_capacity(p_service_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_max_capacity integer;
v_used integer;
BEGIN
SELECT max_capacity INTO v_max_capacity
FROM tour_optional_services
WHERE id = p_service_id;

IF v_max_capacity IS NULL THEN
RETURN NULL;
END IF;

SELECT COALESCE(SUM(bos.quantity), 0) INTO v_used
FROM booking_optional_services bos
JOIN bookings b ON b.id = bos.booking_id
WHERE bos.tour_optional_service_id = p_service_id
AND bos.is_cancelled = false
AND b.status NOT IN ('cancelled');

RETURN GREATEST(0, v_max_capacity - v_used);
END;
$$;

-- 9. get_optional_services_capacity
CREATE OR REPLACE FUNCTION public.get_optional_services_capacity(p_service_ids uuid[])
RETURNS TABLE(service_id uuid, available_capacity integer)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
tos.id AS service_id,
CASE
WHEN tos.max_capacity IS NULL THEN NULL::integer
ELSE GREATEST(0, tos.max_capacity - COALESCE(
(
SELECT SUM(bos.quantity)
FROM booking_optional_services bos
JOIN bookings b ON b.id = bos.booking_id
WHERE bos.tour_optional_service_id = tos.id
AND bos.is_cancelled = false
AND b.status NOT IN ('cancelled')
), 0
)::integer)
END AS available_capacity
FROM tour_optional_services tos
WHERE tos.id = ANY(p_service_ids);
END;
$$;

-- 10. get_preventa_bookings_count
CREATE OR REPLACE FUNCTION public.get_preventa_bookings_count(p_tour_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_count integer;
BEGIN
SELECT COUNT(*)
INTO v_count
FROM bookings
WHERE tour_id = p_tour_id
AND es_reserva_preventa = true
AND status NOT IN ('cancelled');
RETURN COALESCE(v_count, 0);
END;
$$;

-- 11. get_promotions_for_tours
CREATE OR REPLACE FUNCTION public.get_promotions_for_tours(p_tour_ids uuid[])
RETURNS TABLE(tour_id uuid, id uuid, promotion_type text, min_travelers integer, group_size integer, pay_count integer, fixed_group_price numeric, group_discount_percentage numeric, valid_from date, valid_until date, max_uses integer, times_used integer, is_active boolean)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT DISTINCT ON (tp.tour_id)
tp.tour_id,
tp.id,
tp.promotion_type::text,
tp.min_travelers,
tp.group_size,
tp.pay_count,
tp.fixed_group_price,
tp.group_discount_percentage,
tp.valid_from::date,
tp.valid_until::date,
tp.max_uses,
tp.times_used,
tp.is_active
FROM tour_promotions tp
WHERE
tp.tour_id = ANY(p_tour_ids)
AND tp.is_active = true
AND (tp.valid_from IS NULL OR tp.valid_from::date <= CURRENT_DATE)
AND (tp.valid_until IS NULL OR tp.valid_until::date >= CURRENT_DATE)
AND (tp.max_uses IS NULL OR tp.times_used < tp.max_uses)
ORDER BY tp.tour_id, tp.created_at DESC;
END;
$$;

-- 12. get_seat_map_availability
CREATE OR REPLACE FUNCTION public.get_seat_map_availability(
  p_tour_id uuid,
  p_slot_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(seat_number integer, status text, booking_id uuid, block_note text, traveler_name text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
sss.seat_number,
sss.status,
sss.booking_id,
sss.block_note,
CASE
WHEN sss.status = 'reservado_online' AND sss.booking_id IS NOT NULL THEN
COALESCE(
(SELECT u.name FROM users u
JOIN bookings b ON b.user_id = u.id
WHERE b.id = sss.booking_id LIMIT 1),
'Viajero'
)
WHEN sss.status = 'bloqueado_agencia' THEN
COALESCE(sss.block_note, 'Bloqueado')
ELSE NULL
END AS traveler_name
FROM slot_seat_status sss
WHERE sss.tour_id = p_tour_id
AND (
(p_slot_id IS NULL AND sss.slot_id IS NULL)
OR (p_slot_id IS NOT NULL AND sss.slot_id = p_slot_id)
);
END;
$$;

-- 13. get_tour_availability
CREATE OR REPLACE FUNCTION public.get_tour_availability(p_tour_id uuid)
RETURNS TABLE(available_spots integer, max_capacity integer, total_booked integer)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
GREATEST(
0,
COALESCE(
CASE
WHEN t.available_spots IS NOT NULL AND t.available_spots > 0
THEN t.available_spots
ELSE COALESCE(t.max_travelers, 10)
END,
10
) - COALESCE(SUM(b.travelers_count), 0)
)::integer as available_spots,
COALESCE(
CASE
WHEN t.available_spots IS NOT NULL AND t.available_spots > 0
THEN t.available_spots
ELSE COALESCE(t.max_travelers, 10)
END,
10
)::integer as max_capacity,
COALESCE(SUM(b.travelers_count), 0)::integer as total_booked
FROM tours t
LEFT JOIN bookings b
ON b.tour_id = t.id
AND (
b.status = 'confirmed'
OR (b.status = 'pending' AND b.approval_status = 'approved')
)
WHERE t.id = p_tour_id
GROUP BY t.id, t.available_spots, t.max_travelers;
END;
$$;

-- 14. get_tour_availability_v2
CREATE OR REPLACE FUNCTION public.get_tour_availability_v2(
  p_tour_id uuid,
  p_slot_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(available_spots integer, total_capacity integer, booked_count integer, slot_date date, departure_time time)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_tour record;
BEGIN
SELECT * INTO v_tour FROM public.tours WHERE id = p_tour_id;
IF NOT FOUND THEN
RAISE EXCEPTION 'Tour not found: %', p_tour_id;
END IF;

IF p_slot_id IS NOT NULL THEN
RETURN QUERY
SELECT
GREATEST(0, ts.capacity - ts.booked_count) AS available_spots,
ts.capacity AS total_capacity,
ts.booked_count,
ts.slot_date,
ts.departure_time
FROM public.tour_slots ts
WHERE ts.id = p_slot_id
AND ts.tour_id = p_tour_id;
ELSE
RETURN QUERY
SELECT
COALESCE(v_tour.available_spots, v_tour.max_travelers, 0) AS available_spots,
COALESCE(v_tour.max_travelers, 0) AS total_capacity,
COALESCE(v_tour.max_travelers, 0) - COALESCE(v_tour.available_spots, COALESCE(v_tour.max_travelers, 0)) AS booked_count,
v_tour.start_date::date AS slot_date,
NULL::time AS departure_time;
END IF;
END;
$$;

-- 15. get_tours_for_departure_point
CREATE OR REPLACE FUNCTION public.get_tours_for_departure_point(point_id uuid)
RETURNS TABLE(tour_id uuid, tour_name text, agency_name text, display_order integer)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
t.id,
t.name,
a.name,
tdp.display_order
FROM public.tour_departure_points tdp
JOIN public.tours t ON t.id = tdp.tour_id
JOIN public.agencies a ON a.id = t.agency_id
WHERE tdp.departure_point_id = point_id
ORDER BY tdp.display_order ASC;
END;
$$;

-- 16. get_traveler_reschedule_request_ids
CREATE OR REPLACE FUNCTION public.get_traveler_reschedule_request_ids(p_user_id uuid)
RETURNS TABLE(request_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
SELECT srr.request_id
FROM slot_reschedule_responses srr
WHERE srr.user_id = p_user_id;
$$;

-- 17. increment_geocoding_cache_usage (keep DEFINER but revoke anon - only authenticated should update cache)
CREATE OR REPLACE FUNCTION public.increment_geocoding_cache_usage(query_text text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
UPDATE geocoding_cache
SET
usage_count = usage_count + 1,
last_used_at = now()
WHERE search_query = query_text;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.increment_geocoding_cache_usage(text) FROM anon;

-- 18. search_departure_points
CREATE OR REPLACE FUNCTION public.search_departure_points(
  search_query text,
  limit_count integer DEFAULT 20
)
RETURNS TABLE(id uuid, name text, city text, municipality text, google_maps_url text, usage_count integer, relevance_score real)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
normalized_query text;
BEGIN
normalized_query := normalize_text(search_query);

RETURN QUERY
SELECT
dp.id,
dp.name,
dp.city,
dp.municipality,
dp.google_maps_url,
dp.usage_count,
(
CASE
WHEN normalize_text(dp.name) = normalized_query THEN 100
WHEN normalize_text(dp.name) LIKE normalized_query || '%' THEN 80
WHEN normalize_text(dp.name) LIKE '%' || normalized_query || '%' THEN 60
WHEN normalize_text(dp.city) LIKE '%' || normalized_query || '%' THEN 40
WHEN normalize_text(dp.municipality) LIKE '%' || normalized_query || '%' THEN 30
ELSE 20
END
+ (LEAST(dp.usage_count::real / 10, 20))
)::real AS relevance_score
FROM public.departure_points dp
WHERE
dp.is_active = true
AND (
normalize_text(dp.name) LIKE '%' || normalized_query || '%'
OR normalize_text(dp.city) LIKE '%' || normalized_query || '%'
OR normalize_text(dp.municipality) LIKE '%' || normalized_query || '%'
)
ORDER BY relevance_score DESC, dp.usage_count DESC, dp.name ASC
LIMIT limit_count;
END;
$$;

-- 19. search_featured_pois
CREATE OR REPLACE FUNCTION public.search_featured_pois(
  search_query text,
  limit_results integer DEFAULT 10
)
RETURNS TABLE(id uuid, name text, description text, category text, address text, city text, state text, latitude numeric, longitude numeric)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
fp.id,
fp.name,
fp.description,
fp.category,
fp.address,
fp.city,
fp.state,
fp.latitude,
fp.longitude
FROM featured_pois fp
WHERE fp.is_active = true
AND (
fp.name ILIKE '%' || search_query || '%'
OR fp.address ILIKE '%' || search_query || '%'
OR EXISTS (
SELECT 1 FROM unnest(fp.keywords) kw
WHERE kw ILIKE '%' || search_query || '%'
)
)
ORDER BY
CASE
WHEN fp.name ILIKE search_query || '%' THEN 1
WHEN fp.name ILIKE '%' || search_query || '%' THEN 2
ELSE 3
END,
fp.name
LIMIT limit_results;
END;
$$;

-- 20. validate_agency_discount_code
CREATE OR REPLACE FUNCTION public.validate_agency_discount_code(
  p_code text,
  p_tour_id uuid,
  p_user_id uuid
)
RETURNS TABLE(is_valid boolean, discount_code_id uuid, discount_type text, discount_value numeric, error_message text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_code_record RECORD;
v_tour_agency_id uuid;
BEGIN
SELECT agency_id INTO v_tour_agency_id
FROM public.tours
WHERE id = p_tour_id;

SELECT * INTO v_code_record
FROM public.discount_codes
WHERE UPPER(code) = UPPER(p_code)
LIMIT 1;

IF NOT FOUND THEN
RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::numeric, 'Código de descuento no encontrado';
RETURN;
END IF;

IF v_code_record.is_active = false THEN
RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::numeric, 'Código de descuento inactivo';
RETURN;
END IF;

IF now() < v_code_record.valid_from OR now() > v_code_record.valid_until THEN
RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::numeric, 'Código de descuento fuera del período válido';
RETURN;
END IF;

IF v_code_record.max_uses IS NOT NULL AND v_code_record.times_used >= v_code_record.max_uses THEN
RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::numeric, 'Código de descuento ha alcanzado el máximo de usos';
RETURN;
END IF;

IF EXISTS (
SELECT 1 FROM public.discount_code_usage
WHERE discount_code_id = v_code_record.id
AND user_id = p_user_id
) THEN
RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::numeric, 'Ya has usado este código de descuento';
RETURN;
END IF;

IF v_code_record.agency_id IS NOT NULL THEN
IF v_tour_agency_id != v_code_record.agency_id THEN
RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::numeric, 'Este código no es válido para este tour';
RETURN;
END IF;

IF v_code_record.tour_id IS NOT NULL AND v_code_record.tour_id != p_tour_id THEN
RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::numeric, 'Este código solo es válido para un tour específico';
RETURN;
END IF;
END IF;

RETURN QUERY SELECT
true,
v_code_record.id,
v_code_record.discount_type,
v_code_record.discount_value,
NULL::text;
END;
$$;

-- 21. validate_discount_code
CREATE OR REPLACE FUNCTION public.validate_discount_code(
  p_code text,
  p_user_id uuid,
  p_applicable_to text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_code_record record;
v_has_used boolean;
BEGIN
SELECT *
INTO v_code_record
FROM public.discount_codes
WHERE UPPER(code) = UPPER(p_code);

IF v_code_record IS NULL THEN
RETURN jsonb_build_object('valid', false, 'error', 'Código de descuento no encontrado');
END IF;

IF NOT v_code_record.is_active THEN
RETURN jsonb_build_object('valid', false, 'error', 'Este código de descuento no está activo');
END IF;

IF now() < v_code_record.valid_from THEN
RETURN jsonb_build_object('valid', false, 'error', 'Este código de descuento aún no es válido');
END IF;

IF now() > v_code_record.valid_until THEN
RETURN jsonb_build_object('valid', false, 'error', 'Este código de descuento ha expirado');
END IF;

IF p_applicable_to IS NOT NULL AND v_code_record.applicable_to != p_applicable_to THEN
RETURN jsonb_build_object('valid', false, 'error', 'Este código no es aplicable para este tipo de compra');
END IF;

SELECT check_user_code_usage(p_code, p_user_id) INTO v_has_used;

IF v_has_used THEN
RETURN jsonb_build_object('valid', false, 'error', 'Ya has utilizado este código de descuento anteriormente');
END IF;

IF v_code_record.max_uses IS NOT NULL AND v_code_record.times_used >= v_code_record.max_uses THEN
RETURN jsonb_build_object('valid', false, 'error', 'Este código ha alcanzado su límite máximo de usos');
END IF;

RETURN jsonb_build_object(
'valid', true,
'code_id', v_code_record.id,
'code', v_code_record.code,
'description', v_code_record.description,
'discount_type', v_code_record.discount_type,
'discount_value', v_code_record.discount_value,
'applicable_to', v_code_record.applicable_to,
'membership_plan_type', COALESCE(v_code_record.membership_plan_type, 'both')
);
END;
$$;

-- 22. validate_tour_discount_code
CREATE OR REPLACE FUNCTION public.validate_tour_discount_code(
  p_code text,
  p_user_id uuid,
  p_tour_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
v_code_record RECORD;
v_tour_agency_id uuid;
BEGIN
SELECT agency_id INTO v_tour_agency_id
FROM public.tours
WHERE id = p_tour_id;

IF v_tour_agency_id IS NULL THEN
RETURN jsonb_build_object('valid', false, 'error', 'Tour no encontrado');
END IF;

SELECT * INTO v_code_record
FROM public.discount_codes
WHERE UPPER(code) = UPPER(p_code);

IF v_code_record IS NULL THEN
RETURN jsonb_build_object('valid', false, 'error', 'Código de descuento no encontrado');
END IF;

IF NOT v_code_record.is_active THEN
RETURN jsonb_build_object('valid', false, 'error', 'Este código de descuento no está activo');
END IF;

IF now() < v_code_record.valid_from THEN
RETURN jsonb_build_object('valid', false, 'error', 'Este código de descuento aún no es válido');
END IF;

IF now() > v_code_record.valid_until THEN
RETURN jsonb_build_object('valid', false, 'error', 'Este código de descuento ha expirado');
END IF;

IF v_code_record.applicable_to NOT IN ('tours', 'service_fees') THEN
RETURN jsonb_build_object('valid', false, 'error', 'Este código no es aplicable a tours');
END IF;

IF v_code_record.max_uses IS NOT NULL AND v_code_record.times_used >= v_code_record.max_uses THEN
RETURN jsonb_build_object('valid', false, 'error', 'Este código ha alcanzado su límite máximo de usos');
END IF;

IF EXISTS (
SELECT 1 FROM public.discount_code_usage
WHERE discount_code_id = v_code_record.id
AND user_id = p_user_id
) THEN
RETURN jsonb_build_object('valid', false, 'error', 'Ya has utilizado este código de descuento anteriormente');
END IF;

IF v_code_record.agency_id IS NOT NULL THEN
IF v_tour_agency_id != v_code_record.agency_id THEN
RETURN jsonb_build_object('valid', false, 'error', 'Este código no es válido para este tour');
END IF;
END IF;

IF v_code_record.tour_id IS NOT NULL AND v_code_record.tour_id != p_tour_id THEN
RETURN jsonb_build_object('valid', false, 'error', 'Este código solo es válido para un tour específico');
END IF;

RETURN jsonb_build_object(
'valid', true,
'code_id', v_code_record.id,
'code', v_code_record.code,
'description', v_code_record.description,
'discount_type', v_code_record.discount_type,
'discount_value', v_code_record.discount_value,
'discount_applies_to', v_code_record.discount_applies_to,
'max_discount_amount', v_code_record.max_discount_amount,
'applicable_to', v_code_record.applicable_to
);
END;
$$;

-- Restore explicit grants for anon on functions that legitimately serve unauthenticated users
GRANT EXECUTE ON FUNCTION public.calculate_preventa_precio(uuid, numeric) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_transaction_breakdown(text, numeric, numeric, numeric, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_code_usage(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_promotion_for_tour(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_terms(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_agency_reviews_with_users(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_departure_location_suggestions(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_optional_service_available_capacity(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_optional_services_capacity(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_preventa_bookings_count(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_promotions_for_tours(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_seat_map_availability(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tour_availability(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tour_availability_v2(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tours_for_departure_point(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_traveler_reschedule_request_ids(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_departure_points(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_featured_pois(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_agency_discount_code(text, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_discount_code(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_tour_discount_code(text, uuid, uuid) TO anon, authenticated;
