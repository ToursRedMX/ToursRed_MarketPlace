-- ============================================================================
-- CRITICO: cualquier usuario autenticado podia hacerse super admin.
--
-- La politica "Users and super admins can update users" deja a cada quien
-- actualizar SU PROPIA fila (`auth.uid() = id`) sin mirar que columnas toca, y
-- `authenticated` tiene UPDATE sobre todas las columnas de public.users. Con
-- eso, desde la consola del navegador:
--
--   supabase.from('users').update({ role: 'admin', is_super_admin: true })
--     .eq('id', miId)
--
-- y `is_super_admin()` / `is_admin_user()` —que leen justo esas columnas— le
-- abren todas las politicas de administracion. Por el mismo camino una agencia
-- se auto-aprobaba (`is_approved`), un usuario bloqueado se desbloqueaba
-- (`is_active`), cualquiera marcaba su correo como verificado
-- (`email_verified`) o se borraba los no-show (`no_show_count`).
--
-- El 30-ago-2026 se cerro este mismo hueco en el INSERT
-- (20260830194141_fix_users_insert_policy_prevent_role_escalation); el UPDATE
-- quedo abierto. Encontrado el 01-oct-2026 leyendo pg_policies y
-- information_schema.column_privileges.
--
-- POR QUE UN TRIGGER Y NO UN REVOKE DE COLUMNAS
--
-- El super admin SI cambia estas columnas desde el front, sobre filas ajenas
-- (AdminAgencies aprueba, AdminUsers/AdminTravelers activan y desactivan), y
-- lo hace con el mismo rol `authenticated`. Un REVOKE se lo quitaria tambien a
-- el. La regla que importa no es "nadie", es "nadie salvo el super admin", y
-- eso solo se puede decir en un trigger.
--
-- QUIEN PASA
--
--   - El super admin, con la MISMA condicion de AAL2 que ya usa la politica de
--     UPDATE: si el MFA de admins esta activado, sin aal2 no pasa.
--   - Todo lo que no sea `authenticated`/`anon`: service_role (Edge Functions),
--     y las funciones SECURITY DEFINER (update_user_no_show_count,
--     sync_agency_approval_to_user, promote_to_admin), donde current_user es el
--     dueno de la funcion. Tambien las migraciones y el Dashboard.
--
-- Mandar el mismo valor que ya tiene la fila NO cuenta como cambio
-- (IS DISTINCT FROM), para no romper a un cliente que reenvie la fila entera.
--
-- Prueba: scripts/test-users-auto-escalada.sql (corre en CI contra Postgres).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.proteger_columnas_privilegiadas_de_users()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_columna text;
BEGIN
  -- service_role, postgres y los duenos de funciones SECURITY DEFINER pasan.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF public.is_super_admin()
     AND ((NOT public.requires_aal2_check()) OR public.has_aal2()) THEN
    RETURN NEW;
  END IF;

  v_columna := CASE
    WHEN NEW.role           IS DISTINCT FROM OLD.role           THEN 'role'
    WHEN NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN 'is_super_admin'
    WHEN NEW.is_active      IS DISTINCT FROM OLD.is_active      THEN 'is_active'
    WHEN NEW.is_approved    IS DISTINCT FROM OLD.is_approved    THEN 'is_approved'
    WHEN NEW.email_verified IS DISTINCT FROM OLD.email_verified THEN 'email_verified'
    WHEN NEW.no_show_count  IS DISTINCT FROM OLD.no_show_count  THEN 'no_show_count'
  END;

  IF v_columna IS NOT NULL THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar users.%', v_columna
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_columnas_privilegiadas ON public.users;

CREATE TRIGGER trg_proteger_columnas_privilegiadas
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.proteger_columnas_privilegiadas_de_users();
