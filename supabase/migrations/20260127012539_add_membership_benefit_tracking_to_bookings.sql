
DO $$ 
BEGIN
  -- Agregar campo para rastrear si se usó el beneficio de membresía
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'used_membership_benefit'
  ) THEN
    ALTER TABLE bookings ADD COLUMN used_membership_benefit boolean DEFAULT false;
  END IF;

  -- Agregar campo para rastrear cuánto se ahorró con el beneficio
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bookings' AND column_name = 'membership_service_fee_saved'
  ) THEN
    ALTER TABLE bookings ADD COLUMN membership_service_fee_saved numeric DEFAULT 0;
  END IF;
END $$;
