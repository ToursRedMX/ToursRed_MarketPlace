
-- Add can_manage_inquiries column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_permissions' AND column_name = 'can_manage_inquiries'
  ) THEN
    ALTER TABLE admin_permissions
    ADD COLUMN can_manage_inquiries boolean DEFAULT false;
  END IF;
END $$;
