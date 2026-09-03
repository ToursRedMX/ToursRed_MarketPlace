-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827003412
--   name:    routesred_user_platforms
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

/*
# RoutesRed — User Platforms on ToursRed project

Creates public.user_platforms for tracking platform membership.
ToursRed already has public.users, is_super_admin(), current_user_has_role(), etc.
All mutations go through SECURITY DEFINER RPC functions — no direct INSERT/UPDATE/DELETE.
*/

CREATE TABLE IF NOT EXISTS public.user_platforms (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform             text NOT NULL,
  status               text NOT NULL DEFAULT 'active',
  registration_source  text NOT NULL DEFAULT 'routesred',
  registered_at        timestamptz NOT NULL DEFAULT now(),
  last_access_at       timestamptz,
  onboarding_completed boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_platforms_platform_check CHECK (platform IN ('toursred', 'routesred', 'naturestayred')),
  CONSTRAINT user_platforms_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT user_platforms_source_check CHECK (registration_source IN ('toursred', 'routesred', 'naturestayred', 'system'))
);

CREATE UNIQUE INDEX IF NOT EXISTS user_platforms_user_platform_unique
  ON public.user_platforms (user_id, platform);

CREATE INDEX IF NOT EXISTS user_platforms_platform_idx
  ON public.user_platforms (platform);

ALTER TABLE public.user_platforms ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS user_platforms_updated_at ON public.user_platforms;
CREATE TRIGGER user_platforms_updated_at BEFORE UPDATE ON public.user_platforms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP POLICY IF EXISTS "users_read_own_platforms" ON public.user_platforms;
CREATE POLICY "users_read_own_platforms"
  ON public.user_platforms FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_super_admin());

-- No INSERT/UPDATE/DELETE policies — all mutations via RPC

CREATE OR REPLACE FUNCTION routesred.register_platform_access(p_platform text, p_source text DEFAULT 'routesred')
RETURNS public.user_platforms
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, routesred AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.user_platforms;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_platform NOT IN ('routesred', 'naturestayred') THEN RAISE EXCEPTION 'Can only register routesred or naturestayred'; END IF;
  SELECT * INTO v_row FROM public.user_platforms WHERE user_id = v_uid AND platform = p_platform;
  IF v_row IS NULL THEN
    INSERT INTO public.user_platforms (user_id, platform, status, registration_source, registered_at, last_access_at, onboarding_completed)
    VALUES (v_uid, p_platform, 'active', p_source, now(), now(), false) RETURNING * INTO v_row;
  ELSE
    UPDATE public.user_platforms SET last_access_at = now() WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION routesred.register_platform_access(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION routesred.complete_onboarding(p_platform text DEFAULT 'routesred')
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, routesred AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_platform NOT IN ('routesred', 'naturestayred') THEN RAISE EXCEPTION 'Invalid platform'; END IF;
  UPDATE public.user_platforms SET onboarding_completed = true WHERE user_id = v_uid AND platform = p_platform;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION routesred.complete_onboarding(text) TO authenticated;

CREATE OR REPLACE FUNCTION routesred.touch_platform_access(p_platform text DEFAULT 'routesred')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, routesred AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.user_platforms SET last_access_at = now() WHERE user_id = v_uid AND platform = p_platform;
END;
$$;
GRANT EXECUTE ON FUNCTION routesred.touch_platform_access(text) TO authenticated;

;
