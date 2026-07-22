
DROP FUNCTION IF EXISTS public.get_staff_with_permissions(uuid);

CREATE OR REPLACE FUNCTION public.get_staff_with_permissions(p_user_id uuid)
RETURNS TABLE (
  staff_id uuid,
  agency_id uuid,
  agency_name text,
  title text,
  is_active boolean,
  can_scan_checkin boolean,
  can_view_bookings boolean,
  can_view_tours boolean,
  can_edit_tours boolean,
  can_manage_tours boolean,
  can_view_financials boolean,
  can_view_reports boolean,
  can_manage_discount_codes boolean,
  can_view_messages boolean,
  can_manage_destinations boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id AS staff_id,
    s.agency_id,
    a.name AS agency_name,
    s.title,
    s.is_active,
    COALESCE(p.can_scan_checkin, false),
    COALESCE(p.can_view_bookings, false),
    COALESCE(p.can_view_tours, false),
    COALESCE(p.can_edit_tours, false),
    COALESCE(p.can_manage_tours, false),
    COALESCE(p.can_view_financials, false),
    COALESCE(p.can_view_reports, false),
    COALESCE(p.can_manage_discount_codes, false),
    COALESCE(p.can_view_messages, false),
    COALESCE(p.can_manage_destinations, false)
  FROM agency_staff s
  JOIN agencies a ON a.id = s.agency_id
  LEFT JOIN agency_staff_permissions p ON p.staff_id = s.id
  WHERE s.user_id = p_user_id AND s.is_active = true
  ORDER BY s.linked_at ASC;
$$;
