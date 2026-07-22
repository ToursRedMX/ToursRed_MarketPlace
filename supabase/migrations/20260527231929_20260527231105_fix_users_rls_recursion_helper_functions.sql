-- ============================================================
-- 1. Función helper: current_user_has_role(roles text[])
--    Verifica si el usuario autenticado actual tiene alguno de los roles indicados.
--    SECURITY DEFINER para evitar recursión al llamarse desde políticas RLS de users.
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_user_has_role(check_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role = ANY (check_roles)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_has_role(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(text[]) TO authenticated;

-- ============================================================
-- 2. Convertir current_user_is_admin() a SECURITY DEFINER (preventivo)
--    Sin esto, si alguna política de users la llamara causaría el mismo error.
-- ============================================================
CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.current_user_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;

-- ============================================================
-- 3. Convertir get_current_user_agency_id() a SECURITY DEFINER (preventivo)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_current_user_agency_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.agencies WHERE user_id = auth.uid() LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_current_user_agency_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_user_agency_id() TO authenticated;

-- ============================================================
-- 4. Recrear la política SELECT de users sin subconsulta directa a users
--    Reemplaza: EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = ANY (...))
--    Por:       current_user_has_role(ARRAY['admin','accountant'])
-- ============================================================
DROP POLICY IF EXISTS "Users can view own and authorized data" ON public.users;

CREATE POLICY "Users can view own and authorized data"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = id
    OR is_super_admin()
    OR (has_manage_travelers_permission() AND role = 'traveler')
    OR (EXISTS (
      SELECT 1 FROM agencies a
      WHERE a.user_id = (SELECT auth.uid())
        AND EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.user_id = users.id AND b.agency_id = a.id
        )
    ))
    OR current_user_has_role(ARRAY['admin', 'accountant'])
  );
