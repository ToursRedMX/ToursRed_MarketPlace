-- ==========================================
-- TABLA: tour_supplements
-- ==========================================
CREATE TABLE IF NOT EXISTS tour_supplements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id uuid NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price numeric(10, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  requires_approval boolean NOT NULL DEFAULT false,
  is_cancellable boolean NOT NULL DEFAULT false,
  max_capacity integer CHECK (max_capacity IS NULL OR max_capacity > 0),
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tour_supplements ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_tour_supplements_tour_id ON tour_supplements(tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_supplements_active ON tour_supplements(tour_id, is_active);

CREATE POLICY "Anyone can view active tour supplements"
  ON tour_supplements FOR SELECT
  USING (true);

CREATE POLICY "Agency can insert supplements for own tours"
  ON tour_supplements FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tours t
      JOIN agencies a ON a.id = t.agency_id
      WHERE t.id = tour_supplements.tour_id
        AND a.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Agency can update supplements for own tours"
  ON tour_supplements FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tours t
      JOIN agencies a ON a.id = t.agency_id
      WHERE t.id = tour_supplements.tour_id
        AND a.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tours t
      JOIN agencies a ON a.id = t.agency_id
      WHERE t.id = tour_supplements.tour_id
        AND a.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Agency can delete supplements for own tours"
  ON tour_supplements FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tours t
      JOIN agencies a ON a.id = t.agency_id
      WHERE t.id = tour_supplements.tour_id
        AND a.user_id = (SELECT auth.uid())
    )
  );

-- ==========================================
-- TABLA: booking_supplements
-- ==========================================
CREATE TABLE IF NOT EXISTS booking_supplements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  tour_supplement_id uuid NOT NULL REFERENCES tour_supplements(id),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(10, 2) NOT NULL DEFAULT 0,
  service_charge numeric(10, 2) NOT NULL DEFAULT 0,
  membership_exemption_used numeric(10, 2) NOT NULL DEFAULT 0,
  supplement_commission numeric(10, 2) NOT NULL DEFAULT 0,
  total_paid numeric(10, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'approved', 'rejected', 'pending_payment', 'paid', 'cancelled')),
  payment_method text,
  payment_intent_id text,
  rejection_note text,
  expires_at timestamptz,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  paid_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  cancelled_at timestamptz,
  cancelled_by text CHECK (cancelled_by IN ('traveler', 'agency', 'system', 'expiry', 'tour_cancellation')),
  refund_amount numeric(10, 2) NOT NULL DEFAULT 0,
  cfdi_invoice_id uuid,
  points_earned integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE booking_supplements ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_booking_supplements_booking_id ON booking_supplements(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_supplements_supplement_id ON booking_supplements(tour_supplement_id);
CREATE INDEX IF NOT EXISTS idx_booking_supplements_status ON booking_supplements(status);
CREATE INDEX IF NOT EXISTS idx_booking_supplements_expires_at ON booking_supplements(expires_at) WHERE status = 'approved';

-- Viajero ve sus propios suplementos
CREATE POLICY "Traveler can view own booking supplements"
  ON booking_supplements FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_supplements.booking_id
        AND b.user_id = (SELECT auth.uid())
    )
  );

-- Agencia ve los suplementos de sus tours
CREATE POLICY "Agency can view supplements for own tour bookings"
  ON booking_supplements FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      JOIN tours t ON t.id = b.tour_id
      JOIN agencies a ON a.id = t.agency_id
      WHERE b.id = booking_supplements.booking_id
        AND a.user_id = (SELECT auth.uid())
    )
  );

-- Viajero puede insertar (solicitar) suplementos en sus propias reservas
CREATE POLICY "Traveler can insert supplements on own bookings"
  ON booking_supplements FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_supplements.booking_id
        AND b.user_id = (SELECT auth.uid())
    )
  );

-- Admin ve todo
CREATE POLICY "Admin can view all booking supplements"
  ON booking_supplements FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin', 'super_admin')
    )
  );

-- Service role puede hacer todo (edge functions)
CREATE POLICY "Service role can manage booking supplements"
  ON booking_supplements FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- CAMPO: supplement_commission_percentage en platform_settings
-- ==========================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_settings'
      AND column_name = 'supplement_commission_percentage'
  ) THEN
    ALTER TABLE platform_settings
      ADD COLUMN supplement_commission_percentage numeric(5, 2) NOT NULL DEFAULT 10.00;
  END IF;
END $$;

-- ==========================================
-- FUNCIÓN: cupo disponible para un suplemento
-- ==========================================
CREATE OR REPLACE FUNCTION get_supplement_available_capacity(p_supplement_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_max_capacity integer;
  v_used integer;
BEGIN
  SELECT max_capacity INTO v_max_capacity
  FROM tour_supplements
  WHERE id = p_supplement_id;

  IF v_max_capacity IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(bs.quantity), 0) INTO v_used
  FROM booking_supplements bs
  WHERE bs.tour_supplement_id = p_supplement_id
    AND bs.status NOT IN ('rejected', 'cancelled');

  RETURN GREATEST(0, v_max_capacity - v_used);
END;
$$;

GRANT EXECUTE ON FUNCTION get_supplement_available_capacity(uuid) TO authenticated, anon;

-- ==========================================
-- FUNCIÓN: expirar aprobaciones de suplementos vencidas
-- Marca como 'cancelled' (cancelled_by='expiry') los suplementos aprobados
-- cuyo expires_at ya pasó y aún están en estado 'approved'
-- ==========================================
CREATE OR REPLACE FUNCTION expire_supplement_approvals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE booking_supplements
  SET
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = 'expiry',
    updated_at = now()
  WHERE status = 'approved'
    AND expires_at IS NOT NULL
    AND expires_at < now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION expire_supplement_approvals() TO service_role;
