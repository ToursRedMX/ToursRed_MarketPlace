
-- Agregar columna departure_points
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'departure_points'
  ) THEN
    ALTER TABLE tours ADD COLUMN departure_points text[] NOT NULL DEFAULT '{}';
  END IF;
END $$;

-- Crear índice para mejorar búsquedas por punto de partida
CREATE INDEX IF NOT EXISTS idx_tours_departure_points ON tours USING GIN (departure_points);

-- Agregar constraint para asegurar al menos un punto de partida
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tours_departure_points_not_empty'
  ) THEN
    ALTER TABLE tours 
    ADD CONSTRAINT tours_departure_points_not_empty 
    CHECK (array_length(departure_points, 1) > 0);
  END IF;
END $$;
