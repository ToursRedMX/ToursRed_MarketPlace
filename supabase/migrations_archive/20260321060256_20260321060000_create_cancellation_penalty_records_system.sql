
-- 1. NUEVO STATUS EN BOOKINGS
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE bookings
ADD CONSTRAINT bookings_status_check
CHECK (status = ANY (ARRAY[
  'pending'::text,
  'confirmed'::text,
  'cancelled'::text,
  'completed'::text,
  'payment_not_received'::text
]));

-- 2. TABLA cancellation_penalty_records
CREATE TABLE IF NOT EXISTS cancellation_penalty_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  tour_id uuid NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  cancellation_type text NOT NULL DEFAULT 'full' CHECK (cancellation_type IN ('full', 'partial')),
  cancellation_id uuid,
  partial_cancellation_id uuid,
  cancellation_policy_type text NOT NULL CHECK (cancellation_policy_type IN ('50_percent', 'no_refund')),
  original_booking_amount numeric(10, 2) NOT NULL DEFAULT 0,
  gross_penalty numeric(10, 2) NOT NULL DEFAULT 0,
  agency_net_amount numeric(10, 2) NOT NULL DEFAULT 0,
  platform_amount numeric(10, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed')),
  processed_at timestamptz,
  payment_method text,
  payment_notes text,
  payment_receipt_url text,
  payment_receipt_filename text,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cancellation_penalty_records_booking_id
  ON cancellation_penalty_records(booking_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_penalty_records_agency_id
  ON cancellation_penalty_records(agency_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_penalty_records_tour_id
  ON cancellation_penalty_records(tour_id);
CREATE INDEX IF NOT EXISTS idx_cancellation_penalty_records_status
  ON cancellation_penalty_records(status);
CREATE INDEX IF NOT EXISTS idx_cancellation_penalty_records_cancellation_id
  ON cancellation_penalty_records(cancellation_id) WHERE cancellation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cancellation_penalty_records_created_at
  ON cancellation_penalty_records(created_at DESC);

ALTER TABLE cancellation_penalty_records ENABLE ROW LEVEL SECURITY;

-- 3. RLS POLICIES
CREATE POLICY "Agencies can view own cancellation penalties"
  ON cancellation_penalty_records
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = cancellation_penalty_records.agency_id
      AND agencies.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Travelers can view penalties for own bookings"
  ON cancellation_penalty_records
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = cancellation_penalty_records.booking_id
      AND bookings.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Admins can view all cancellation penalties"
  ON cancellation_penalty_records
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can update cancellation penalties"
  ON cancellation_penalty_records
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
      AND users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Service role can insert cancellation penalties"
  ON cancellation_penalty_records
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update cancellation penalties"
  ON cancellation_penalty_records
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Travelers can insert penalties for own bookings"
  ON cancellation_penalty_records
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = cancellation_penalty_records.booking_id
      AND bookings.user_id = (SELECT auth.uid())
    )
  );

-- 4. TRIGGER updated_at
CREATE OR REPLACE FUNCTION update_cancellation_penalty_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS update_cancellation_penalty_records_updated_at_trigger
  ON cancellation_penalty_records;

CREATE TRIGGER update_cancellation_penalty_records_updated_at_trigger
  BEFORE UPDATE ON cancellation_penalty_records
  FOR EACH ROW
  EXECUTE FUNCTION update_cancellation_penalty_records_updated_at();

-- 5. FUNCION HELPER: get_agency_penalty_summary
CREATE OR REPLACE FUNCTION get_agency_penalty_summary(p_agency_id uuid)
RETURNS TABLE (
  total_pending numeric,
  total_processed numeric,
  pending_count bigint,
  processed_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN cpr.status = 'pending' THEN cpr.agency_net_amount ELSE 0 END), 0) AS total_pending,
    COALESCE(SUM(CASE WHEN cpr.status = 'processed' THEN cpr.agency_net_amount ELSE 0 END), 0) AS total_processed,
    COUNT(CASE WHEN cpr.status = 'pending' THEN 1 END) AS pending_count,
    COUNT(CASE WHEN cpr.status = 'processed' THEN 1 END) AS processed_count
  FROM cancellation_penalty_records cpr
  WHERE cpr.agency_id = p_agency_id;
END;
$$;
