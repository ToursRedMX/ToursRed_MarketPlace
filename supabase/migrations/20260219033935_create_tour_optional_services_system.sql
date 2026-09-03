-- ==============================
-- TABLA: tour_optional_services
-- ==============================
CREATE TABLE IF NOT EXISTS tour_optional_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id uuid NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price_per_person numeric(10, 2) NOT NULL DEFAULT 0,
  max_capacity integer,
  is_refundable boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tour_optional_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active optional services"
  ON tour_optional_services
  FOR SELECT
  USING (true);

CREATE POLICY "Agency can insert optional services for own tours"
  ON tour_optional_services
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tours t
      JOIN agencies a ON a.id = t.agency_id
      WHERE t.id = tour_optional_services.tour_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "Agency can update optional services for own tours"
  ON tour_optional_services
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tours t
      JOIN agencies a ON a.id = t.agency_id
      WHERE t.id = tour_optional_services.tour_id
        AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tours t
      JOIN agencies a ON a.id = t.agency_id
      WHERE t.id = tour_optional_services.tour_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "Agency can delete optional services for own tours"
  ON tour_optional_services
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tours t
      JOIN agencies a ON a.id = t.agency_id
      WHERE t.id = tour_optional_services.tour_id
        AND a.user_id = auth.uid()
    )
  );

-- ==============================
-- TABLA: booking_optional_services
-- ==============================
CREATE TABLE IF NOT EXISTS booking_optional_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  tour_optional_service_id uuid NOT NULL REFERENCES tour_optional_services(id),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(10, 2) NOT NULL DEFAULT 0,
  subtotal numeric(10, 2) NOT NULL DEFAULT 0,
  is_cancelled boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  refund_amount numeric(10, 2) NOT NULL DEFAULT 0,
  cancelled_by_agency boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE booking_optional_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Traveler can view own booking optional services"
  ON booking_optional_services
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_optional_services.booking_id
        AND b.user_id = auth.uid()
    )
  );

CREATE POLICY "Agency can view optional services for own tour bookings"
  ON booking_optional_services
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      JOIN tours t ON t.id = b.tour_id
      JOIN agencies a ON a.id = t.agency_id
      WHERE b.id = booking_optional_services.booking_id
        AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "Traveler can insert optional services on own bookings"
  ON booking_optional_services
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = booking_optional_services.booking_id
        AND b.user_id = auth.uid()
    )
  );

CREATE POLICY "Admin can view all booking optional services"
  ON booking_optional_services
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admin can update booking optional services"
  ON booking_optional_services
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'super_admin')
    )
  );

-- Permitir al service role actualizar (para procesamiento de cancelaciones desde edge functions)
CREATE POLICY "Service role can manage booking optional services"
  ON booking_optional_services
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ==============================
-- FUNCION: calcular cupo disponible para un servicio opcional
-- ==============================
CREATE OR REPLACE FUNCTION get_optional_service_available_capacity(p_service_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_capacity integer;
  v_used integer;
BEGIN
  SELECT max_capacity INTO v_max_capacity
  FROM tour_optional_services
  WHERE id = p_service_id;

  IF v_max_capacity IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(bos.quantity), 0) INTO v_used
  FROM booking_optional_services bos
  JOIN bookings b ON b.id = bos.booking_id
  WHERE bos.tour_optional_service_id = p_service_id
    AND bos.is_cancelled = false
    AND b.status NOT IN ('cancelled');

  RETURN GREATEST(0, v_max_capacity - v_used);
END;
$$;

-- ==============================
-- FUNCION: cancelar opcionales de una reserva (con logica de agencia vs viajero)
-- ==============================
CREATE OR REPLACE FUNCTION cancel_booking_optional_services(
  p_booking_id uuid,
  p_cancelled_by_agency boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE booking_optional_services bos
  SET
    is_cancelled = true,
    cancelled_at = now(),
    cancelled_by_agency = p_cancelled_by_agency,
    refund_amount = CASE
      WHEN p_cancelled_by_agency = true THEN bos.subtotal
      ELSE
        CASE
          WHEN tos.is_refundable = true THEN bos.subtotal
          ELSE 0
        END
    END,
    updated_at = now()
  FROM tour_optional_services tos
  WHERE bos.tour_optional_service_id = tos.id
    AND bos.booking_id = p_booking_id
    AND bos.is_cancelled = false;
END;
$$;

-- ==============================
-- INDEXES para performance
-- ==============================
CREATE INDEX IF NOT EXISTS idx_tour_optional_services_tour_id
  ON tour_optional_services(tour_id);

CREATE INDEX IF NOT EXISTS idx_tour_optional_services_active
  ON tour_optional_services(tour_id, is_active);

CREATE INDEX IF NOT EXISTS idx_booking_optional_services_booking_id
  ON booking_optional_services(booking_id);

CREATE INDEX IF NOT EXISTS idx_booking_optional_services_service_id
  ON booking_optional_services(tour_optional_service_id);
