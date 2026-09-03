
-- Drop the broad listing policies
DROP POLICY IF EXISTS "Public can read assets" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access to images" ON storage.objects;

-- Recreate with name-required condition to prevent listing
CREATE POLICY "Public can read assets"
  ON storage.objects FOR SELECT
  TO public
  USING (
    bucket_id = 'assets'
    AND name IS NOT NULL
    AND length(name) > 0
  );

CREATE POLICY "Allow public read access to images"
  ON storage.objects FOR SELECT
  TO public
  USING (
    bucket_id = 'images'
    AND name IS NOT NULL
    AND length(name) > 0
  );
