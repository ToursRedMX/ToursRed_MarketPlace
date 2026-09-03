/*
# Mark base64 image columns as deprecated

## Context
After migrating all base64 image data to Supabase Storage (bucket 'images'),
the base64 columns in `destinations` and `destination_images` are no longer
used. All image data now lives as public URLs in the `*_url` columns.

## Changes
1. Clear any remaining base64 data from deprecated columns (set to NULL)
2. Add deprecation comments on the columns
3. No columns are dropped (data safety policy)

## Why not drop?
Per data safety rules, we never DROP columns. The columns remain in the
schema but are marked deprecated and should not be written to by the frontend.
*/

-- Clear any residual base64 data
UPDATE destinations SET main_image_base64 = NULL WHERE main_image_base64 IS NOT NULL;
UPDATE destination_images SET image_base64 = NULL WHERE image_base64 IS NOT NULL;

-- Mark as deprecated
COMMENT ON COLUMN destinations.main_image_base64 IS 'DEPRECATED — images now stored in Supabase Storage bucket "images", URL in main_image_url';
COMMENT ON COLUMN destination_images.image_base64 IS 'DEPRECATED — images now stored in Supabase Storage bucket "images", URL in image_url';
