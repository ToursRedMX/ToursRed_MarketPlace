
CREATE OR REPLACE FUNCTION public.sync_tour_slots_capacity_for_tour(p_tour_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE tour_slots ts
  SET
    capacity = GREATEST(
      COALESCE(sch.slot_capacity, t.default_slot_capacity, ts.capacity),
      ts.booked_count
    ),
    updated_at = now()
  FROM tour_schedules sch
  JOIN tours t ON t.id = sch.tour_id
  WHERE
    ts.schedule_id = sch.id
    AND sch.tour_id = p_tour_id
    AND ts.slot_date >= CURRENT_DATE
    AND ts.status = 'available';
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_tour_slots_capacity_for_tour(uuid) TO authenticated;
