
-- Add can_manage_categories column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_permissions' AND column_name = 'can_manage_categories'
  ) THEN
    ALTER TABLE admin_permissions
    ADD COLUMN can_manage_categories boolean DEFAULT false;
  END IF;
END $$;

-- Add can_manage_departure_points column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_permissions' AND column_name = 'can_manage_departure_points'
  ) THEN
    ALTER TABLE admin_permissions
    ADD COLUMN can_manage_departure_points boolean DEFAULT false;
  END IF;
END $$;
