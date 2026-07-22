
DROP FUNCTION IF EXISTS public.get_tour_confirmed_attendees(uuid, uuid);

CREATE FUNCTION public.get_tour_confirmed_attendees(
  p_tour_id uuid,
  p_slot_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  booking_id uuid,
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  travelers_count integer,
  selected_date date,
  selected_time time
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
RETURN QUERY
SELECT
  b.id AS booking_id,
  b.user_id,
  u.email,
  u.first_name,
  u.last_name,
  b.travelers_count,
  b.selected_date,
  b.selected_time
FROM bookings b
JOIN users u ON u.id = b.user_id
WHERE
  b.tour_id = p_tour_id
  AND b.status = 'confirmed'
  AND (p_slot_id IS NULL OR b.slot_id = p_slot_id);
END;
$function$;
