
ALTER TABLE agency_staff_permissions
  ADD COLUMN IF NOT EXISTS can_view_tours boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_edit_tours boolean DEFAULT false;

-- Backfill: staff with full manage also gets edit and view
UPDATE agency_staff_permissions
SET
  can_view_tours = true,
  can_edit_tours = true
WHERE can_manage_tours = true;
