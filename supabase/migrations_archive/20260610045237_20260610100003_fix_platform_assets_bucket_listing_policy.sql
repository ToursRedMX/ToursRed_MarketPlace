-- Eliminar la política que permite listado público del bucket completo
DROP POLICY IF EXISTS "platform_assets_public_read" ON storage.objects;

-- Los admins pueden listar y acceder a archivos del bucket (para gestión en AdminSettings)
CREATE POLICY "platform_assets_admin_read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'platform-assets'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = (SELECT auth.uid())
        AND users.role IN ('admin', 'super_admin')
    )
  );
