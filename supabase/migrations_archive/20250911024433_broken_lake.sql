
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agencies' AND column_name = 'rnt'
  ) THEN
    ALTER TABLE agencies ADD COLUMN rnt text;
    COMMENT ON COLUMN agencies.rnt IS 'Registro Nacional de Turismo (opcional)';
  END IF;
END $$;
