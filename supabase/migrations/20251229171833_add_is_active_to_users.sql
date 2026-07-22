
-- Add is_active field to users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.users ADD COLUMN is_active boolean DEFAULT true;
  END IF;
END $$;
