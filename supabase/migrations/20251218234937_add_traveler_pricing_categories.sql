
-- Agregar campos de precio por categoría a tours
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'precio_adulto'
  ) THEN
    ALTER TABLE tours ADD COLUMN precio_adulto decimal(10,2);
    ALTER TABLE tours ADD COLUMN precio_nino decimal(10,2);
    ALTER TABLE tours ADD COLUMN precio_infante decimal(10,2);
    ALTER TABLE tours ADD COLUMN precio_adulto_mayor decimal(10,2);
  END IF;
END $$;

-- Agregar campos para indicar categorías admitidas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'admite_infantes'
  ) THEN
    ALTER TABLE tours ADD COLUMN admite_infantes boolean DEFAULT true NOT NULL;
    ALTER TABLE tours ADD COLUMN admite_ninos boolean DEFAULT true NOT NULL;
    ALTER TABLE tours ADD COLUMN admite_adultos boolean DEFAULT true NOT NULL;
    ALTER TABLE tours ADD COLUMN admite_adultos_mayores boolean DEFAULT true NOT NULL;
  END IF;
END $$;

-- Crear tabla de acompañantes frecuentes
CREATE TABLE IF NOT EXISTS frequent_companions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  email text NOT NULL,
  telefono text,
  fecha_nacimiento date NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Índices para frequent_companions
CREATE INDEX IF NOT EXISTS idx_frequent_companions_user_id ON frequent_companions(user_id);

-- Crear tabla de viajeros por reserva
CREATE TABLE IF NOT EXISTS booking_travelers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  categoria_viajero text NOT NULL CHECK (categoria_viajero IN ('infante', 'nino', 'adulto', 'adulto_mayor')),
  nombre text NOT NULL,
  email text NOT NULL,
  telefono text,
  fecha_nacimiento date NOT NULL,
  precio_aplicado decimal(10,2) NOT NULL,
  frequent_companion_id uuid REFERENCES frequent_companions(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Índices para booking_travelers
CREATE INDEX IF NOT EXISTS idx_booking_travelers_booking_id ON booking_travelers(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_travelers_frequent_companion_id ON booking_travelers(frequent_companion_id);

-- RLS para frequent_companions
ALTER TABLE frequent_companions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own frequent companions"
  ON frequent_companions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own frequent companions"
  ON frequent_companions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own frequent companions"
  ON frequent_companions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own frequent companions"
  ON frequent_companions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS para booking_travelers
ALTER TABLE booking_travelers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Travelers can view own booking travelers"
  ON booking_travelers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = booking_travelers.booking_id
      AND bookings.user_id = auth.uid()
    )
  );

CREATE POLICY "Agencies can view their bookings travelers"
  ON booking_travelers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      JOIN agencies ON agencies.id = bookings.agency_id
      WHERE bookings.id = booking_travelers.booking_id
      AND agencies.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can view all booking travelers"
  ON booking_travelers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE POLICY "Travelers can insert own booking travelers"
  ON booking_travelers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = booking_travelers.booking_id
      AND bookings.user_id = auth.uid()
    )
  );

CREATE POLICY "Travelers can update own booking travelers"
  ON booking_travelers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = booking_travelers.booking_id
      AND bookings.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = booking_travelers.booking_id
      AND bookings.user_id = auth.uid()
    )
  );
