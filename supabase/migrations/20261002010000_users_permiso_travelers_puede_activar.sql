-- ============================================================================
-- can_manage_travelers nunca tuvo respaldo en RLS para escribir.
--
-- La politica de UPDATE de users exige `auth.uid() = id` O `is_super_admin()`
-- desde que existe (20251229172051, 29-dic-2025) -- ANTES de que existiera
-- siquiera `admin_permissions.can_manage_travelers` (el mismo dia, despues).
-- Un admin con el permiso pero sin ser super admin no podia tocar NINGUNA
-- fila de otro usuario: el UPDATE afecta 0 filas, sin error.
--
-- En produccion, medido el 02-oct-2026: contacto@toursred.com tiene
-- can_manage_travelers = true y is_super_admin = false.
-- `AdminTravelers.toggleActiveStatus` no revisa cuantas filas afecto el
-- UPDATE y actualiza el estado local igual -- parece funcionar y no toca la
-- base. `AdminUsers` (mismo patron, is_active de staff) si recarga despues,
-- asi que el toggle "no pega" visualmente, sin explicar por que.
--
-- El mismo hueco YA se habia cerrado del lado del SELECT: la politica
-- "Users can view own and authorized data" (20251229181433,
-- add_admin_view_travelers_policy) agrego
-- `has_manage_travelers_permission() AND role = 'traveler'`. El UPDATE nunca
-- se extendio igual. Encontrado el 02-oct-2026 leyendo pg_policies y
-- admin_permissions en produccion (pendiente 2 de la entrada 33 de la
-- bitacora).
--
-- ALCANCE, A PROPOSITO: el permiso solo destraba `is_active`, y solo sobre
-- filas `role = 'traveler'`. `role`, `is_super_admin`, `is_approved`,
-- `email_verified` y `no_show_count` siguen siendo exclusivos del super admin
-- (20261001010000_users_bloquea_auto_escalada.sql) -- extender el carve-out a
-- esas columnas reabriria la escalada que esa migracion cerro. Por eso el
-- carve-out vive en el trigger mirando `v_columna`, no en un REVOKE ni en la
-- politica: la politica solo decide SI LA FILA se puede tocar, el trigger
-- decide QUE COLUMNA.
--
-- Mismo gate de AAL2 que ya aplica al super admin: si mfa_required_for_admins
-- esta activado (hoy lo esta, medido el 02-oct-2026), el admin con el permiso
-- tambien necesita aal2 antes de que el carve-out lo deje pasar.
--
-- Prueba: scripts/test-users-permiso-travelers.sql (mismo arnes que
-- test-users-auto-escalada.sql, corre en CI contra Postgres real).
-- ============================================================================

ALTER POLICY "Users and super admins can update users" ON public.users
USING (
  ((SELECT auth.uid()) = id)
  OR (is_super_admin() AND ((NOT requires_aal2_check()) OR has_aal2()))
  OR (has_manage_travelers_permission() AND role = 'traveler' AND ((NOT requires_aal2_check()) OR has_aal2()))
)
WITH CHECK (
  ((SELECT auth.uid()) = id)
  OR (is_super_admin() AND ((NOT requires_aal2_check()) OR has_aal2()))
  OR (has_manage_travelers_permission() AND role = 'traveler' AND ((NOT requires_aal2_check()) OR has_aal2()))
);

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

  -- Unico carve-out: is_active sobre un viajero, para quien tiene el permiso
  -- y (si el MFA de admins esta activado) ya probo aal2. Si v_columna NO es
  -- 'is_active' (por ejemplo cambio role O is_active A LA VEZ), no entra aqui
  -- y cae en la excepcion de abajo igual que para cualquiera sin privilegios.
  IF v_columna = 'is_active'
     AND OLD.role = 'traveler'
     AND public.has_manage_travelers_permission()
     AND ((NOT public.requires_aal2_check()) OR public.has_aal2()) THEN
    RETURN NEW;
  END IF;

  IF v_columna IS NOT NULL THEN
    RAISE EXCEPTION 'No tienes permiso para cambiar users.%', v_columna
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
