DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'support_categories' AND column_name = 'aplica_a'
  ) THEN
    ALTER TABLE support_categories ADD COLUMN aplica_a text[] NOT NULL DEFAULT '{general,traveler,agency}';
  END IF;
END $$;
