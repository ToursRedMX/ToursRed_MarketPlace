
DROP FUNCTION IF EXISTS public.get_completed_tours_with_commission_status();

CREATE OR REPLACE FUNCTION public.get_completed_tours_with_commission_status()
RETURNS TABLE(
  tour_id uuid,
  tour_name text,
  agency_id uuid,
  agency_name text,
  end_date date,
  days_completed integer,
  bookings_count bigint,
  total_revenue numeric,
  commission_records_exist boolean,
  commission_records_count bigint,
  total_commission_pending numeric,
  total_commission_processed numeric,
  payment_status text,
  ready_for_payout boolean,
  can_create_commissions boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
RETURN QUERY
SELECT
  t.id as tour_id,
  t.name as tour_name,
  t.agency_id,
  a.name as agency_name,
  t.end_date,
  (CURRENT_DATE - t.end_date)::integer as days_completed,
  COUNT(DISTINCT b.id) as bookings_count,
  COALESCE(SUM(b.total_price), 0)::numeric as total_revenue,
  EXISTS(
    SELECT 1 FROM commission_records cr
    WHERE cr.tour_id = t.id
  ) as commission_records_exist,
  COALESCE((
    SELECT COUNT(*) FROM commission_records cr
    WHERE cr.tour_id = t.id
  ), 0) as commission_records_count,
  COALESCE((
    SELECT SUM(cr.agency_net_amount)
    FROM commission_records cr
    WHERE cr.tour_id = t.id
    AND cr.status = 'pending'
  ), 0)::numeric as total_commission_pending,
  COALESCE((
    SELECT SUM(cr.agency_net_amount)
    FROM commission_records cr
    WHERE cr.tour_id = t.id
    AND cr.status = 'processed'
  ), 0)::numeric as total_commission_processed,
  CASE
    WHEN NOT EXISTS(SELECT 1 FROM commission_records cr2 WHERE cr2.tour_id = t.id)
      THEN 'no_commissions'
    WHEN NOT EXISTS(SELECT 1 FROM commission_records cr2 WHERE cr2.tour_id = t.id AND cr2.status = 'pending')
      AND EXISTS(SELECT 1 FROM commission_records cr2 WHERE cr2.tour_id = t.id AND cr2.status = 'processed')
      THEN 'processed'
    WHEN EXISTS(SELECT 1 FROM commission_records cr2 WHERE cr2.tour_id = t.id AND cr2.status = 'pending')
      AND EXISTS(SELECT 1 FROM commission_records cr2 WHERE cr2.tour_id = t.id AND cr2.status = 'processed')
      THEN 'partial'
    ELSE 'pending'
  END as payment_status,
  (
    (CURRENT_DATE - t.end_date >= 3)
    AND EXISTS(SELECT 1 FROM commission_records cr2 WHERE cr2.tour_id = t.id AND cr2.status = 'pending')
  ) as ready_for_payout,
  (
    NOT EXISTS(SELECT 1 FROM commission_records cr2 WHERE cr2.tour_id = t.id)
    AND EXISTS(SELECT 1 FROM bookings b2 WHERE b2.tour_id = t.id AND b2.status = 'confirmed' AND b2.payment_status = 'succeeded')
  ) as can_create_commissions
FROM tours t
INNER JOIN agencies a ON a.id = t.agency_id
LEFT JOIN bookings b ON b.tour_id = t.id
  AND b.status = 'confirmed'
  AND b.payment_status = 'succeeded'
WHERE t.end_date < CURRENT_DATE
GROUP BY t.id, t.name, t.agency_id, a.name, t.end_date
HAVING COUNT(DISTINCT b.id) > 0
ORDER BY t.end_date DESC;
END;
$$;
