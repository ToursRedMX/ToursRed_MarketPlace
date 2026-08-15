
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'name_changes_not_allowed'
  ) THEN
    ALTER TABLE tours ADD COLUMN name_changes_not_allowed boolean NOT NULL DEFAULT false;
  END IF;
END $$;
