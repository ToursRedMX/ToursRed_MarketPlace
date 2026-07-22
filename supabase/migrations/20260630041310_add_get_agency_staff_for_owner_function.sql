-- Funcion SECURITY DEFINER para que el propietario de una agencia
-- pueda obtener su staff completo sin que RLS en users bloquee el join.
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Solo el propietario de la agencia puede llamar esta funcion
  IF NOT EXISTS (
    SELECT 1 FROM agencies
    WHERE id = p_agency_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
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
END;
$$;

REVOKE ALL ON FUNCTION public.get_agency_staff_for_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_agency_staff_for_owner(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_agency_staff_for_owner(uuid) TO authenticated;
