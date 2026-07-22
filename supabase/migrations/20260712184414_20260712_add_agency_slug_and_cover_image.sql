-- Add custom_slug and cover_image_url to agencies table
ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS custom_slug text,
  ADD COLUMN IF NOT EXISTS cover_image_url text;

-- Unique index on custom_slug (case-insensitive, partial so NULLs are allowed)
CREATE UNIQUE INDEX IF NOT EXISTS agencies_custom_slug_unique
  ON agencies (lower(custom_slug))
  WHERE custom_slug IS NOT NULL;

-- Allow agency owners to update their own slug and cover image
-- (existing update policy already covers all columns via the owner's user_id check,
--  so no new policy needed — but we confirm by checking existing policies exist)
