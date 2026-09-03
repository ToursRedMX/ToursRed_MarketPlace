-- Create platform-assets storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'platform-assets',
  'platform-assets',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access
CREATE POLICY "platform_assets_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'platform-assets');

-- Allow admins to upload
CREATE POLICY "platform_assets_admin_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'platform-assets'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid())
      AND role IN ('admin', 'super_admin')
    )
  );

-- Allow admins to delete
CREATE POLICY "platform_assets_admin_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'platform-assets'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid())
      AND role IN ('admin', 'super_admin')
    )
  );

-- Allow admins to update
CREATE POLICY "platform_assets_admin_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'platform-assets'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = (SELECT auth.uid())
      AND role IN ('admin', 'super_admin')
    )
  );