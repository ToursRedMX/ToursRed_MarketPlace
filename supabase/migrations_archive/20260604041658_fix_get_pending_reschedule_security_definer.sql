
CREATE OR REPLACE FUNCTION public.get_pending_reschedule_for_booking(p_booking_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  SELECT json_build_object(
    'reschedule', json_build_object(
      'id', tr.id, 'tour_id', tr.tour_id, 'tour_name', t.name,
      'original_start_date', tr.original_start_date, 'original_end_date', tr.original_end_date,
      'new_start_date', tr.new_start_date, 'new_end_date', tr.new_end_date,
      'reason', tr.reason, 'response_deadline', tr.response_deadline, 'created_at', tr.created_at
    ),
    'response', json_build_object(
      'id', brr.id, 'response', brr.response, 'responded_at', brr.responded_at,
      'notification_sent', brr.notification_sent, 'email_sent', brr.email_sent
    )
  ) INTO v_result
  FROM booking_reschedule_responses brr
  INNER JOIN tour_reschedules tr ON brr.tour_reschedule_id = tr.id
  INNER JOIN tours t ON tr.tour_id = t.id
  WHERE brr.booking_id = p_booking_id
    AND brr.response = 'pending'
    AND tr.status = 'pending_responses'
    AND tr.response_deadline > now()
  ORDER BY tr.created_at DESC
  LIMIT 1;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_reschedule_for_booking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_reschedule_for_booking(uuid) TO authenticated, service_role;
