
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'flexible_hours'
  ) THEN
    ALTER TABLE tours ADD COLUMN flexible_hours integer DEFAULT 48 CHECK (flexible_hours > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'flexible_refund_percentage'
  ) THEN
    ALTER TABLE tours ADD COLUMN flexible_refund_percentage integer DEFAULT 100 CHECK (flexible_refund_percentage >= 0 AND flexible_refund_percentage <= 100);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'moderate_hours'
  ) THEN
    ALTER TABLE tours ADD COLUMN moderate_hours integer DEFAULT 24 CHECK (moderate_hours > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tours' AND column_name = 'moderate_refund_percentage'
  ) THEN
    ALTER TABLE tours ADD COLUMN moderate_refund_percentage integer DEFAULT 50 CHECK (moderate_refund_percentage >= 0 AND moderate_refund_percentage <= 100);
  END IF;
END $$;
