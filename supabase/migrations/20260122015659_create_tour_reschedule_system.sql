
-- Crear tabla para registrar reagendamientos de tours
CREATE TABLE IF NOT EXISTS tour_reschedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id UUID NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  original_start_date DATE NOT NULL,
  original_end_date DATE NOT NULL,
  new_start_date DATE NOT NULL,
  new_end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  affected_bookings_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_responses' 
    CHECK (status IN ('pending_responses', 'completed', 'cancelled')),
  response_deadline TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Crear tabla para registrar respuestas de viajeros a reagendamientos
CREATE TABLE IF NOT EXISTS booking_reschedule_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_reschedule_id UUID NOT NULL REFERENCES tour_reschedules(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  response TEXT NOT NULL DEFAULT 'pending'
    CHECK (response IN ('pending', 'accepted', 'rejected', 'auto_accepted')),
  responded_at TIMESTAMPTZ,
  refund_processed BOOLEAN NOT NULL DEFAULT false,
  refund_transaction_id UUID REFERENCES toursred_cash_transactions(id),
  notification_sent BOOLEAN NOT NULL DEFAULT false,
  email_sent BOOLEAN NOT NULL DEFAULT false,
  reminder_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(booking_id, tour_reschedule_id)
);

-- Agregar campos a la tabla bookings para rastrear reagendamientos
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'has_pending_reschedule'
  ) THEN
    ALTER TABLE bookings ADD COLUMN has_pending_reschedule BOOLEAN NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'reschedule_response'
  ) THEN
    ALTER TABLE bookings ADD COLUMN reschedule_response TEXT 
      CHECK (reschedule_response IN ('accepted', 'rejected', 'auto_accepted'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'reschedule_responded_at'
  ) THEN
    ALTER TABLE bookings ADD COLUMN reschedule_responded_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'original_booking_date'
  ) THEN
    ALTER TABLE bookings ADD COLUMN original_booking_date DATE;
  END IF;
END $$;

-- Actualizar el enum notification_type para incluir tour_rescheduled
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'tour_rescheduled' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notification_type')
  ) THEN
    ALTER TYPE notification_type ADD VALUE 'tour_rescheduled';
  END IF;
END $$;

-- Crear índices para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_tour_reschedules_tour_id ON tour_reschedules(tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_reschedules_agency_id ON tour_reschedules(agency_id);
CREATE INDEX IF NOT EXISTS idx_tour_reschedules_status ON tour_reschedules(status);
CREATE INDEX IF NOT EXISTS idx_booking_reschedule_responses_booking_id ON booking_reschedule_responses(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_reschedule_responses_user_id ON booking_reschedule_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_booking_reschedule_responses_tour_reschedule_id ON booking_reschedule_responses(tour_reschedule_id);
CREATE INDEX IF NOT EXISTS idx_bookings_has_pending_reschedule ON bookings(has_pending_reschedule) WHERE has_pending_reschedule = true;

-- Habilitar RLS en las nuevas tablas
ALTER TABLE tour_reschedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_reschedule_responses ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para tour_reschedules

-- Las agencias pueden ver sus propios reagendamientos
CREATE POLICY "Agencies can view own reschedules"
  ON tour_reschedules FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = auth.uid()
    )
  );

-- Las agencias pueden crear reagendamientos para sus tours
CREATE POLICY "Agencies can create reschedules"
  ON tour_reschedules FOR INSERT
  TO authenticated
  WITH CHECK (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = auth.uid()
    )
  );

-- Las agencias pueden actualizar sus reagendamientos
CREATE POLICY "Agencies can update own reschedules"
  ON tour_reschedules FOR UPDATE
  TO authenticated
  USING (
    agency_id IN (
      SELECT id FROM agencies WHERE user_id = auth.uid()
    )
  );

-- Los viajeros pueden ver reagendamientos que afectan sus reservas
CREATE POLICY "Travelers can view reschedules affecting their bookings"
  ON tour_reschedules FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT tour_reschedule_id 
      FROM booking_reschedule_responses 
      WHERE user_id = auth.uid()
    )
  );

-- Políticas RLS para booking_reschedule_responses

-- Los viajeros pueden ver sus propias respuestas
CREATE POLICY "Users can view own reschedule responses"
  ON booking_reschedule_responses FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Las agencias pueden ver respuestas de sus tours
CREATE POLICY "Agencies can view responses to their reschedules"
  ON booking_reschedule_responses FOR SELECT
  TO authenticated
  USING (
    tour_reschedule_id IN (
      SELECT id FROM tour_reschedules 
      WHERE agency_id IN (
        SELECT id FROM agencies WHERE user_id = auth.uid()
      )
    )
  );

-- Los viajeros pueden actualizar sus propias respuestas
CREATE POLICY "Users can update own reschedule responses"
  ON booking_reschedule_responses FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Sistema puede crear respuestas (para edge functions)
CREATE POLICY "Service role can insert responses"
  ON booking_reschedule_responses FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Sistema puede actualizar respuestas (para edge functions)
CREATE POLICY "Service role can update all responses"
  ON booking_reschedule_responses FOR UPDATE
  TO authenticated
  USING (true);

-- Comentarios en las tablas
COMMENT ON TABLE tour_reschedules IS 'Registra reagendamientos de tours realizados por agencias';
COMMENT ON TABLE booking_reschedule_responses IS 'Registra respuestas de viajeros a reagendamientos de tours';
COMMENT ON COLUMN bookings.has_pending_reschedule IS 'Indica si la reserva tiene un reagendamiento pendiente de respuesta';
COMMENT ON COLUMN bookings.reschedule_response IS 'Respuesta del viajero al reagendamiento: accepted, rejected, auto_accepted';
COMMENT ON COLUMN bookings.original_booking_date IS 'Fecha original de la reserva antes del reagendamiento';
