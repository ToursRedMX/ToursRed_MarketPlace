
-- Agregar campo available_spots a tours
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'available_spots'
  ) THEN
    ALTER TABLE tours ADD COLUMN available_spots integer;
    
    -- Comentario explicativo
    COMMENT ON COLUMN tours.available_spots IS 'Número de lugares disponibles personalizado por la agencia. Si es NULL, se usa max_travelers.';
  END IF;
END $$;
