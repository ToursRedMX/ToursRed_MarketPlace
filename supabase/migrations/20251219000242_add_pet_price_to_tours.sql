

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'precio_mascota'
  ) THEN
    ALTER TABLE tours ADD COLUMN precio_mascota decimal(10,2);
  END IF;
END $$;
