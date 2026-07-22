-- ============================================================
-- TABLA: agency_staff_invitations
-- Almacena invitaciones enviadas por agencias a personas que
-- aun no tienen cuenta en la plataforma para unirse como coordinadores.
-- ============================================================
CREATE TABLE IF NOT EXISTS agency_staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT 'Coordinador',
  permissions jsonb NOT NULL DEFAULT '{
    "can_scan_checkin": false,
    "can_view_bookings": false,
    "can_view_tours": false,
    "can_edit_tours": false,
    "can_manage_tours": false,
    "can_view_financials": false,
    "can_view_reports": false,
    "can_manage_discount_codes": false,
    "can_view_messages": false,
    "can_manage_destinations": false
  }'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'cancelled')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agency_staff_invitations_token
  ON agency_staff_invitations(token);

CREATE INDEX IF NOT EXISTS idx_agency_staff_invitations_agency_id
  ON agency_staff_invitations(agency_id);

CREATE INDEX IF NOT EXISTS idx_agency_staff_invitations_invited_email
  ON agency_staff_invitations(invited_email);

CREATE INDEX IF NOT EXISTS idx_agency_staff_invitations_status
  ON agency_staff_invitations(status);

ALTER TABLE agency_staff_invitations ENABLE ROW LEVEL SECURITY;

-- La agencia duena puede ver sus propias invitaciones
CREATE POLICY "Agency can view own invitations"
  ON agency_staff_invitations FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users WHERE id = (SELECT auth.uid()) AND role IN ('admin', 'super_admin')
    )
  );

-- La agencia duena puede crear invitaciones
CREATE POLICY "Agency can insert own invitations"
  ON agency_staff_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
  );

-- La agencia duena puede cancelar/actualizar sus invitaciones
-- El sistema (via SECURITY DEFINER) puede marcarlas como aceptadas
CREATE POLICY "Agency can update own invitations"
  ON agency_staff_invitations FOR UPDATE
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users WHERE id = (SELECT auth.uid()) AND role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users WHERE id = (SELECT auth.uid()) AND role IN ('admin', 'super_admin')
    )
  );

-- ============================================================
-- FUNCION: accept_staff_invitation
-- Llamada desde el frontend tras el signup de un usuario invitado.
-- Valida el token y vincula automaticamente al usuario como coordinador.
-- ============================================================
CREATE OR REPLACE FUNCTION public.accept_staff_invitation(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation RECORD;
  v_caller_id uuid;
  v_caller_email text;
  v_staff_id uuid;
  v_existing_staff_id uuid;
BEGIN
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No autenticado');
  END IF;

  -- Obtener datos del usuario autenticado
  SELECT email INTO v_caller_email
  FROM public.users
  WHERE id = v_caller_id;

  -- Obtener la invitacion
  SELECT * INTO v_invitation
  FROM agency_staff_invitations
  WHERE token = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invitacion no encontrada');
  END IF;

  IF v_invitation.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'La invitacion ya no esta activa');
  END IF;

  IF v_invitation.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'La invitacion ha expirado');
  END IF;

  -- Verificar si ya existe como staff activo en esa agencia
  SELECT id INTO v_existing_staff_id
  FROM agency_staff
  WHERE agency_id = v_invitation.agency_id
    AND user_id = v_caller_id
    AND is_active = true
  LIMIT 1;

  IF v_existing_staff_id IS NOT NULL THEN
    -- Ya es coordinador activo, solo marcar invitacion como aceptada
    UPDATE agency_staff_invitations
    SET status = 'accepted', accepted_at = now()
    WHERE id = v_invitation.id;
    RETURN jsonb_build_object('success', true, 'already_staff', true);
  END IF;

  -- Verificar si existe como staff inactivo (reactivar)
  SELECT id INTO v_existing_staff_id
  FROM agency_staff
  WHERE agency_id = v_invitation.agency_id
    AND user_id = v_caller_id
    AND is_active = false
  LIMIT 1;

  IF v_existing_staff_id IS NOT NULL THEN
    UPDATE agency_staff
    SET is_active = true,
        title = v_invitation.title,
        linked_at = now(),
        unlinked_at = NULL
    WHERE id = v_existing_staff_id;

    v_staff_id := v_existing_staff_id;

    -- Actualizar permisos existentes
    UPDATE agency_staff_permissions
    SET
      can_scan_checkin       = (v_invitation.permissions->>'can_scan_checkin')::boolean,
      can_view_bookings      = (v_invitation.permissions->>'can_view_bookings')::boolean,
      can_view_tours         = (v_invitation.permissions->>'can_view_tours')::boolean,
      can_edit_tours         = (v_invitation.permissions->>'can_edit_tours')::boolean,
      can_manage_tours       = (v_invitation.permissions->>'can_manage_tours')::boolean,
      can_view_financials    = (v_invitation.permissions->>'can_view_financials')::boolean,
      can_view_reports       = (v_invitation.permissions->>'can_view_reports')::boolean,
      can_manage_discount_codes = (v_invitation.permissions->>'can_manage_discount_codes')::boolean,
      can_view_messages      = (v_invitation.permissions->>'can_view_messages')::boolean,
      can_manage_destinations= (v_invitation.permissions->>'can_manage_destinations')::boolean,
      updated_at             = now()
    WHERE staff_id = v_staff_id;

    IF NOT FOUND THEN
      INSERT INTO agency_staff_permissions (
        staff_id, can_scan_checkin, can_view_bookings, can_view_tours,
        can_edit_tours, can_manage_tours, can_view_financials, can_view_reports,
        can_manage_discount_codes, can_view_messages, can_manage_destinations
      ) VALUES (
        v_staff_id,
        (v_invitation.permissions->>'can_scan_checkin')::boolean,
        (v_invitation.permissions->>'can_view_bookings')::boolean,
        (v_invitation.permissions->>'can_view_tours')::boolean,
        (v_invitation.permissions->>'can_edit_tours')::boolean,
        (v_invitation.permissions->>'can_manage_tours')::boolean,
        (v_invitation.permissions->>'can_view_financials')::boolean,
        (v_invitation.permissions->>'can_view_reports')::boolean,
        (v_invitation.permissions->>'can_manage_discount_codes')::boolean,
        (v_invitation.permissions->>'can_view_messages')::boolean,
        (v_invitation.permissions->>'can_manage_destinations')::boolean
      );
    END IF;
  ELSE
    -- Insertar nuevo registro de staff
    INSERT INTO agency_staff (agency_id, user_id, title, is_active)
    VALUES (v_invitation.agency_id, v_caller_id, v_invitation.title, true)
    RETURNING id INTO v_staff_id;

    -- Insertar permisos
    INSERT INTO agency_staff_permissions (
      staff_id, can_scan_checkin, can_view_bookings, can_view_tours,
      can_edit_tours, can_manage_tours, can_view_financials, can_view_reports,
      can_manage_discount_codes, can_view_messages, can_manage_destinations
    ) VALUES (
      v_staff_id,
      (v_invitation.permissions->>'can_scan_checkin')::boolean,
      (v_invitation.permissions->>'can_view_bookings')::boolean,
      (v_invitation.permissions->>'can_view_tours')::boolean,
      (v_invitation.permissions->>'can_edit_tours')::boolean,
      (v_invitation.permissions->>'can_manage_tours')::boolean,
      (v_invitation.permissions->>'can_view_financials')::boolean,
      (v_invitation.permissions->>'can_view_reports')::boolean,
      (v_invitation.permissions->>'can_manage_discount_codes')::boolean,
      (v_invitation.permissions->>'can_view_messages')::boolean,
      (v_invitation.permissions->>'can_manage_destinations')::boolean
    );
  END IF;

  -- Marcar invitacion como aceptada
  UPDATE agency_staff_invitations
  SET status = 'accepted', accepted_at = now()
  WHERE id = v_invitation.id;

  RETURN jsonb_build_object('success', true, 'staff_id', v_staff_id);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_staff_invitation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_staff_invitation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_staff_invitation(uuid) TO authenticated;
