-- ============================================================
-- TABLA: agency_staff
-- ============================================================
CREATE TABLE IF NOT EXISTS agency_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text DEFAULT 'Coordinador',
  is_active boolean DEFAULT true,
  linked_at timestamptz DEFAULT now(),
  unlinked_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT unique_active_staff_per_agency UNIQUE (agency_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_staff_agency_id ON agency_staff(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_staff_user_id ON agency_staff(user_id);
CREATE INDEX IF NOT EXISTS idx_agency_staff_is_active ON agency_staff(is_active);

ALTER TABLE agency_staff ENABLE ROW LEVEL SECURITY;

-- Agencia puede ver su propio staff
CREATE POLICY "Agency can view own staff"
  ON agency_staff FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
    OR user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

-- Agencia puede agregar staff
CREATE POLICY "Agency can insert own staff"
  ON agency_staff FOR INSERT
  TO authenticated
  WITH CHECK (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

-- Agencia puede actualizar su staff (ej. desvincular)
CREATE POLICY "Agency can update own staff"
  ON agency_staff FOR UPDATE
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  )
  WITH CHECK (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

-- ============================================================
-- TABLA: agency_staff_permissions
-- ============================================================
CREATE TABLE IF NOT EXISTS agency_staff_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES agency_staff(id) ON DELETE CASCADE,
  can_scan_checkin boolean DEFAULT false,
  can_view_bookings boolean DEFAULT false,
  can_manage_tours boolean DEFAULT false,
  can_view_financials boolean DEFAULT false,
  can_view_reports boolean DEFAULT false,
  can_manage_discount_codes boolean DEFAULT false,
  can_view_messages boolean DEFAULT false,
  can_manage_destinations boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_permissions_per_staff UNIQUE (staff_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_staff_permissions_staff_id ON agency_staff_permissions(staff_id);

ALTER TABLE agency_staff_permissions ENABLE ROW LEVEL SECURITY;

-- Misma logica de acceso: agencia duena o el propio coordinador o admin
CREATE POLICY "Agency can view staff permissions"
  ON agency_staff_permissions FOR SELECT
  TO authenticated
  USING (
    staff_id IN (
      SELECT s.id FROM agency_staff s
      JOIN agencies a ON a.id = s.agency_id
      WHERE a.user_id = (SELECT auth.uid())
    )
    OR staff_id IN (
      SELECT id FROM agency_staff WHERE user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

CREATE POLICY "Agency can insert staff permissions"
  ON agency_staff_permissions FOR INSERT
  TO authenticated
  WITH CHECK (
    staff_id IN (
      SELECT s.id FROM agency_staff s
      JOIN agencies a ON a.id = s.agency_id
      WHERE a.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

CREATE POLICY "Agency can update staff permissions"
  ON agency_staff_permissions FOR UPDATE
  TO authenticated
  USING (
    staff_id IN (
      SELECT s.id FROM agency_staff s
      JOIN agencies a ON a.id = s.agency_id
      WHERE a.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  )
  WITH CHECK (
    staff_id IN (
      SELECT s.id FROM agency_staff s
      JOIN agencies a ON a.id = s.agency_id
      WHERE a.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users WHERE id = (SELECT auth.uid()) AND role = 'admin'
    )
  );

-- ============================================================
-- MODIFICACION: booking_checkin_tokens - auditoria de coordinador
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_checkin_tokens' AND column_name = 'scanned_by_staff_id'
  ) THEN
    ALTER TABLE booking_checkin_tokens
      ADD COLUMN scanned_by_staff_id uuid REFERENCES agency_staff(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- FUNCION: get_staff_agency_id
-- Retorna el agency_id activo de un coordinador dado su user_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_staff_agency_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT agency_id
  FROM agency_staff
  WHERE user_id = p_user_id AND is_active = true
  LIMIT 1;
$$;

-- ============================================================
-- FUNCION: get_staff_with_permissions
-- Retorna info completa del staff + permisos para un usuario dado
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_staff_with_permissions(p_user_id uuid)
RETURNS TABLE (
  staff_id uuid,
  agency_id uuid,
  agency_name text,
  title text,
  is_active boolean,
  can_scan_checkin boolean,
  can_view_bookings boolean,
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
  LIMIT 1;
$$;
