-- Agregar campo booking_deadline si no existe
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'booking_deadline'
  ) THEN
    ALTER TABLE tours ADD COLUMN booking_deadline date;
  END IF;
END $$;

-- Verificar que todos los campos necesarios existen
DO $$
BEGIN
  -- Verificar includes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'includes'
  ) THEN
    ALTER TABLE tours ADD COLUMN includes text[];
  END IF;

  -- Verificar excludes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'excludes'
  ) THEN
    ALTER TABLE tours ADD COLUMN excludes text[];
  END IF;
END $$;

-- Comentarios para documentación
COMMENT ON COLUMN tours.booking_deadline IS 'Fecha límite para realizar reservas del tour';
COMMENT ON COLUMN tours.includes IS 'Lista de elementos incluidos en el tour';
COMMENT ON COLUMN tours.excludes IS 'Lista de elementos no incluidos en el tour';
