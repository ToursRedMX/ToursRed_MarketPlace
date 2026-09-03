-- ============================================================
-- 1. Eliminar la política anon problemática
-- ============================================================
DROP POLICY IF EXISTS "Anon can view basic user info" ON public.users;

-- ============================================================
-- 2. Convertir is_super_admin() a SECURITY DEFINER para evitar recursión
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND is_super_admin = true
  );
END;
$$;

-- ============================================================
-- 3. Convertir has_manage_travelers_permission() a SECURITY DEFINER
-- ============================================================
CREATE OR REPLACE FUNCTION public.has_manage_travelers_permission()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role text;
  v_is_admin boolean;
BEGIN
  SELECT role, is_super_admin INTO user_role, v_is_admin
  FROM public.users WHERE id = auth.uid();

  IF v_is_admin = true THEN RETURN true; END IF;
  IF user_role = 'admin' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.admin_permissions
      WHERE user_id = auth.uid() AND can_manage_travelers = true
    );
  END IF;
  RETURN false;
END;
$$;

-- ============================================================
-- 4. Revocar acceso público a estas funciones (solo callable por roles autorizados)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.has_manage_travelers_permission() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_manage_travelers_permission() TO authenticated;
