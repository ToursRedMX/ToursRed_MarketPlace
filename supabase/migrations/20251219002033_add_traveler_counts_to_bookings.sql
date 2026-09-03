
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'count_adultos'
  ) THEN
    ALTER TABLE bookings ADD COLUMN count_adultos integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'count_ninos'
  ) THEN
    ALTER TABLE bookings ADD COLUMN count_ninos integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'count_infantes'
  ) THEN
    ALTER TABLE bookings ADD COLUMN count_infantes integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'count_adultos_mayores'
  ) THEN
    ALTER TABLE bookings ADD COLUMN count_adultos_mayores integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'count_mascotas'
  ) THEN
    ALTER TABLE bookings ADD COLUMN count_mascotas integer DEFAULT 0;
  END IF;
END $$;
