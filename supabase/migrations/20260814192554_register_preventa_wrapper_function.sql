-- Register the preventa validation wrapper function
-- This was already created via execute_sql, this migration records it formally

-- The wrapper function create_booking_atomic_with_preventa validates preventa
-- eligibility before delegating to create_booking_atomic

-- Grant execute to authenticated role
GRANT EXECUTE ON FUNCTION public.create_booking_atomic_with_preventa(jsonb, jsonb, jsonb, text, integer[]) TO authenticated, service_role, postgres;

-- Also grant execute on check_preventa_eligibility
GRANT EXECUTE ON FUNCTION public.check_preventa_eligibility(uuid, uuid, boolean) TO authenticated, service_role, postgres;