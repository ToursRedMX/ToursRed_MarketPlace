-- Tabla principal de solicitudes de reagendado de slots
CREATE TABLE IF NOT EXISTS slot_reschedule_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_slot_id uuid NOT NULL REFERENCES tour_slots(id),
  tour_id uuid NOT NULL REFERENCES tours(id),
  agency_id uuid NOT NULL REFERENCES agencies(id),
  resolution_type text NOT NULL CHECK (resolution_type IN ('new_slot', 'expand_capacity')),
  target_slot_id uuid REFERENCES tour_slots(id),
  reason text NOT NULL,
  response_deadline timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending_responses' CHECK (status IN ('pending_responses', 'completed', 'cancelled')),
  affected_bookings_count integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  auto_accepted_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Tabla de respuestas individuales de viajeros
CREATE TABLE IF NOT EXISTS slot_reschedule_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES slot_reschedule_requests(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  response text NOT NULL DEFAULT 'pending' CHECK (response IN ('pending', 'accepted', 'rejected', 'auto_accepted')),
  responded_at timestamptz,
  refund_processed boolean NOT NULL DEFAULT false,
  refund_amount numeric(10,2),
  refund_transaction_id text,
  notification_sent boolean NOT NULL DEFAULT false,
  email_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Agregar columnas a bookings para rastrear reagendado de slot
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'has_pending_slot_reschedule'
  ) THEN
    ALTER TABLE bookings ADD COLUMN has_pending_slot_reschedule boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'slot_reschedule_response'
  ) THEN
    ALTER TABLE bookings ADD COLUMN slot_reschedule_response text CHECK (slot_reschedule_response IN ('accepted', 'rejected', 'auto_accepted'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'slot_reschedule_responded_at'
  ) THEN
    ALTER TABLE bookings ADD COLUMN slot_reschedule_responded_at timestamptz;
  END IF;
END $$;

-- Indices para performance
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_requests_original_slot ON slot_reschedule_requests(original_slot_id);
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_requests_tour_id ON slot_reschedule_requests(tour_id);
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_requests_agency_id ON slot_reschedule_requests(agency_id);
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_requests_status ON slot_reschedule_requests(status);
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_requests_deadline ON slot_reschedule_requests(response_deadline) WHERE status = 'pending_responses';

CREATE INDEX IF NOT EXISTS idx_slot_reschedule_responses_request_id ON slot_reschedule_responses(request_id);
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_responses_booking_id ON slot_reschedule_responses(booking_id);
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_responses_user_id ON slot_reschedule_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_slot_reschedule_responses_response ON slot_reschedule_responses(response) WHERE response = 'pending';

CREATE INDEX IF NOT EXISTS idx_bookings_has_pending_slot_reschedule ON bookings(has_pending_slot_reschedule) WHERE has_pending_slot_reschedule = true;

-- Habilitar RLS
ALTER TABLE slot_reschedule_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE slot_reschedule_responses ENABLE ROW LEVEL SECURITY;

-- Politicas RLS para slot_reschedule_requests

CREATE POLICY "Agencies can view own slot reschedule requests"
  ON slot_reschedule_requests FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Agencies can insert own slot reschedule requests"
  ON slot_reschedule_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Agencies can update own slot reschedule requests"
  ON slot_reschedule_requests FOR UPDATE
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Travelers can view slot reschedule requests affecting their bookings"
  ON slot_reschedule_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM slot_reschedule_responses srr
      JOIN bookings b ON b.id = srr.booking_id
      WHERE srr.request_id = slot_reschedule_requests.id
      AND b.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Service role can manage slot reschedule requests"
  ON slot_reschedule_requests FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can view all slot reschedule requests"
  ON slot_reschedule_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u WHERE u.id = (SELECT auth.uid()) AND u.role IN ('admin', 'super_admin')
    )
  );

-- Politicas RLS para slot_reschedule_responses

CREATE POLICY "Agencies can view responses to their requests"
  ON slot_reschedule_responses FOR SELECT
  TO authenticated
  USING (
    request_id IN (
      SELECT id FROM slot_reschedule_requests WHERE agency_id IN (
        SELECT id FROM agencies WHERE user_id = (SELECT auth.uid())
      )
    )
  );

CREATE POLICY "Travelers can view their own responses"
  ON slot_reschedule_responses FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Travelers can update their own pending responses"
  ON slot_reschedule_responses FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND response = 'pending'
    AND EXISTS (
      SELECT 1 FROM slot_reschedule_requests srr
      WHERE srr.id = request_id
      AND srr.status = 'pending_responses'
      AND srr.response_deadline > now()
    )
  )
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "Service role can manage slot reschedule responses"
  ON slot_reschedule_responses FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can view all slot reschedule responses"
  ON slot_reschedule_responses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u WHERE u.id = (SELECT auth.uid()) AND u.role IN ('admin', 'super_admin')
    )
  );
