-- Columnas de Pick Up en tours
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tours' AND column_name = 'pickup_available') THEN
    ALTER TABLE tours ADD COLUMN pickup_available boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tours' AND column_name = 'pickup_free_zone') THEN
    ALTER TABLE tours ADD COLUMN pickup_free_zone text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tours' AND column_name = 'pickup_zones') THEN
    ALTER TABLE tours ADD COLUMN pickup_zones jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Columna de idiomas en tours
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tours' AND column_name = 'tour_languages') THEN
    ALTER TABLE tours ADD COLUMN tour_languages jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Columnas de restricciones físicas en tours
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tours' AND column_name = 'restriction_pregnant') THEN
    ALTER TABLE tours ADD COLUMN restriction_pregnant boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tours' AND column_name = 'restriction_disability') THEN
    ALTER TABLE tours ADD COLUMN restriction_disability boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tours' AND column_name = 'restriction_physical') THEN
    ALTER TABLE tours ADD COLUMN restriction_physical boolean DEFAULT false;
  END IF;
END $$;

-- Columnas de reserva receptiva en bookings
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'pickup_type') THEN
    ALTER TABLE bookings ADD COLUMN pickup_type text CHECK (pickup_type IN ('meeting_point', 'pickup'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'pickup_zone_name') THEN
    ALTER TABLE bookings ADD COLUMN pickup_zone_name text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'pickup_zone_extra_cost') THEN
    ALTER TABLE bookings ADD COLUMN pickup_zone_extra_cost decimal(10,2) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'pickup_cost_type') THEN
    ALTER TABLE bookings ADD COLUMN pickup_cost_type text CHECK (pickup_cost_type IN ('por_persona', 'por_reserva'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'selected_language') THEN
    ALTER TABLE bookings ADD COLUMN selected_language text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'language_extra_cost') THEN
    ALTER TABLE bookings ADD COLUMN language_extra_cost decimal(10,2) DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'language_cost_type') THEN
    ALTER TABLE bookings ADD COLUMN language_cost_type text CHECK (language_cost_type IN ('por_persona', 'fijo'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'restrictions_accepted') THEN
    ALTER TABLE bookings ADD COLUMN restrictions_accepted boolean DEFAULT false;
  END IF;
END $$;
