-- Campos de contacto de emergencia en la tabla users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'emergency_contact_name'
  ) THEN
    ALTER TABLE users ADD COLUMN emergency_contact_name text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'emergency_contact_phone'
  ) THEN
    ALTER TABLE users ADD COLUMN emergency_contact_phone text;
  END IF;
END $$;

-- Campos de documento y contacto de emergencia en booking_travelers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_travelers' AND column_name = 'documento_tipo'
  ) THEN
    ALTER TABLE booking_travelers ADD COLUMN documento_tipo text CHECK (documento_tipo IN ('curp', 'pasaporte'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_travelers' AND column_name = 'documento_numero'
  ) THEN
    ALTER TABLE booking_travelers ADD COLUMN documento_numero text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_travelers' AND column_name = 'emergency_contact_name'
  ) THEN
    ALTER TABLE booking_travelers ADD COLUMN emergency_contact_name text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'booking_travelers' AND column_name = 'emergency_contact_phone'
  ) THEN
    ALTER TABLE booking_travelers ADD COLUMN emergency_contact_phone text;
  END IF;
END $$;

-- Campos de documento y contacto de emergencia en frequent_companions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'frequent_companions' AND column_name = 'documento_tipo'
  ) THEN
    ALTER TABLE frequent_companions ADD COLUMN documento_tipo text CHECK (documento_tipo IN ('curp', 'pasaporte'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'frequent_companions' AND column_name = 'documento_numero'
  ) THEN
    ALTER TABLE frequent_companions ADD COLUMN documento_numero text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'frequent_companions' AND column_name = 'emergency_contact_name'
  ) THEN
    ALTER TABLE frequent_companions ADD COLUMN emergency_contact_name text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'frequent_companions' AND column_name = 'emergency_contact_phone'
  ) THEN
    ALTER TABLE frequent_companions ADD COLUMN emergency_contact_phone text;
  END IF;
END $$;
