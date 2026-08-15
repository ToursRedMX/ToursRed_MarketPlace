
CREATE OR REPLACE FUNCTION sync_tour_slots_capacity_for_tour(p_tour_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tour RECORD;
BEGIN
  SELECT default_slot_capacity, max_travelers INTO v_tour
  FROM tours WHERE id = p_tour_id;

  UPDATE tour_slots ts
  SET capacity = COALESCE(
    (SELECT s.slot_capacity FROM tour_schedules s
     WHERE s.tour_id = p_tour_id
       AND s.is_active = true
       AND s.departure_time = ts.departure_time
     LIMIT 1),
    v_tour.default_slot_capacity,
    COALESCE(v_tour.max_travelers, 20)
  )
  WHERE ts.tour_id = p_tour_id
    AND ts.status = 'activo'
    AND ts.slot_date >= CURRENT_DATE;
END;
$$;
