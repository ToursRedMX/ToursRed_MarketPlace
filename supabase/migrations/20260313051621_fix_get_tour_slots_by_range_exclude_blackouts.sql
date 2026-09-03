
CREATE OR REPLACE FUNCTION public.get_tour_slots_by_range(
  p_tour_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  id uuid,
  tour_id uuid,
  agency_id uuid,
  schedule_id uuid,
  slot_date date,
  departure_time time without time zone,
  end_date date,
  capacity integer,
  booked_count integer,
  available_count integer,
  status slot_status_enum,
  is_auto_generated boolean,
  min_travelers_reached boolean,
  notes text,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ts.id,
    ts.tour_id,
    ts.agency_id,
    ts.schedule_id,
    ts.slot_date,
    ts.departure_time,
    ts.end_date,
    ts.capacity,
    ts.booked_count,
    GREATEST(0, ts.capacity - ts.booked_count) AS available_count,
    ts.status,
    ts.is_auto_generated,
    ts.min_travelers_reached,
    ts.notes,
    ts.created_at
  FROM public.tour_slots ts
  WHERE ts.tour_id = p_tour_id
    AND ts.slot_date >= p_start_date
    AND ts.slot_date <= p_end_date
    AND ts.status != 'cancelado'
    AND NOT EXISTS (
      SELECT 1
      FROM public.tour_slot_blackouts b
      WHERE b.tour_id = p_tour_id
        AND ts.slot_date >= b.blackout_start::date
        AND ts.slot_date <= b.blackout_end::date
    )
  ORDER BY ts.slot_date ASC, ts.departure_time ASC;
END;
$$;
