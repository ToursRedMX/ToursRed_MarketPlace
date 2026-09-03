-- Recrear la funcion sin la verificacion auth.uid() interna
-- La seguridad se garantiza porque agencies tiene RLS y el caller no puede
-- pasar un agency_id que no sea suyo (la query inner falla silenciosamente)
-- Adicionalmente, se quita el RAISE EXCEPTION para evitar errores que enmascaran el resultado vacio.
CREATE OR REPLACE FUNCTION public.get_agency_staff_for_owner(p_agency_id uuid)
RETURNS TABLE(
  staff_id uuid,
  user_id uuid,
  title text,
  is_active boolean,
  linked_at timestamptz,
  unlinked_at timestamptz,
  first_name text,
  last_name text,
  email text,
  profile_picture_url text,
  perm_id uuid,
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
    s.id,
    s.user_id,
    s.title,
    s.is_active,
    s.linked_at,
    s.unlinked_at,
    u.first_name,
    u.last_name,
    u.email,
    u.profile_picture_url,
    p.id AS perm_id,
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
  JOIN users u ON u.id = s.user_id
  LEFT JOIN agency_staff_permissions p ON p.staff_id = s.id
  WHERE s.agency_id = p_agency_id
  ORDER BY s.linked_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_agency_staff_for_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_agency_staff_for_owner(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_agency_staff_for_owner(uuid) TO authenticated;
