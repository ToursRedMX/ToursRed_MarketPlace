
CREATE OR REPLACE FUNCTION public.get_active_promotion_for_tour(p_tour_id uuid)
RETURNS TABLE(
  id uuid,
  promotion_type text,
  min_travelers integer,
  group_size integer,
  pay_count integer,
  fixed_group_price numeric,
  group_discount_percentage numeric,
  valid_from date,
  valid_until date,
  max_uses integer,
  times_used integer,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;
