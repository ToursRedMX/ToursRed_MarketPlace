/*
# Add partial unique index: one active promotion per tour

## Purpose
Prevents two promotions from being active simultaneously for the same tour.
The "one active promotion per tour" rule was only enforced client-side (TOCTOU race).
This partial unique index enforces it at the database level.

## Changes
- Creates a partial unique index on tour_promotions(tour_id) WHERE is_active = true
- This means only ONE row per tour_id can have is_active=true at any time
- Existing duplicate active promotions (if any) are first de-duplicated by keeping the most recent one

## Security
- No RLS changes
- No data loss (duplicates are deactivated, not deleted)
*/

-- First, deactivate any duplicate active promotions, keeping the most recent one per tour
UPDATE tour_promotions tp
SET is_active = false, updated_at = now()
WHERE is_active = true
  AND id NOT IN (
    SELECT DISTINCT ON (tour_id) id
    FROM tour_promotions
    WHERE is_active = true
    ORDER BY tour_id, valid_until DESC, created_at DESC
  );

-- Create the partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_promotion_per_tour
  ON tour_promotions (tour_id)
  WHERE is_active = true;