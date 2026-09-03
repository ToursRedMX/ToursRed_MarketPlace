-- 1. Drop the recursive policy on tour_slots (the new one we added)
DROP POLICY IF EXISTS "Travelers can view target slots via their responses" ON tour_slots;

-- 2. Drop the recursive policy on slot_reschedule_requests
DROP POLICY IF EXISTS "Travelers can view slot reschedule requests affecting their boo" ON slot_reschedule_requests;

-- 3. Drop the recursive policy on slot_reschedule_responses  
DROP POLICY IF EXISTS "Agencies can view responses to their requests" ON slot_reschedule_responses;

-- 4. Recreate slot_reschedule_responses agency policy WITHOUT joining slot_reschedule_requests
--    Instead, join directly to slot_reschedule_requests using a subquery that doesn't trigger RLS
--    Use SECURITY DEFINER function approach via a stable function
CREATE OR REPLACE FUNCTION public.get_agency_request_ids(p_user_id uuid)
RETURNS TABLE(request_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT srq.id
  FROM slot_reschedule_requests srq
  JOIN agencies a ON a.id = srq.agency_id
  WHERE a.user_id = p_user_id;
$$;

-- 5. Recreate agencies policy on slot_reschedule_responses using the function (bypasses RLS)
CREATE POLICY "Agencies can view responses to their requests"
  ON slot_reschedule_responses
  FOR SELECT
  TO authenticated
  USING (
    request_id IN (SELECT request_id FROM public.get_agency_request_ids((SELECT auth.uid())))
  );

-- 6. Recreate travelers policy on slot_reschedule_requests WITHOUT joining slot_reschedule_responses
--    Travelers can see requests if they have a response record (use user_id on responses)
CREATE OR REPLACE FUNCTION public.get_traveler_reschedule_request_ids(p_user_id uuid)
RETURNS TABLE(request_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT srr.request_id
  FROM slot_reschedule_responses srr
  WHERE srr.user_id = p_user_id;
$$;

CREATE POLICY "Travelers can view slot reschedule requests affecting their boo"
  ON slot_reschedule_requests
  FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT request_id FROM public.get_traveler_reschedule_request_ids((SELECT auth.uid())))
  );

-- 7. Recreate tour_slots policy for travelers viewing target slots - simple, no cross-join cycle
--    Use the SECURITY DEFINER function to avoid RLS recursion
CREATE POLICY "Travelers can view target slots via their responses"
  ON tour_slots
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM slot_reschedule_requests srq
      WHERE srq.target_slot_id = tour_slots.id
        AND srq.id IN (SELECT request_id FROM public.get_traveler_reschedule_request_ids((SELECT auth.uid())))
    )
  );
