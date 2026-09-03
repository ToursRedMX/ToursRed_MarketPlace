-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830192138
--   name:    fix_images_bucket_insert_policy_folder_ownership
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

DROP POLICY IF EXISTS "Allow authenticated users to upload images" ON storage.objects;

CREATE POLICY "Allow authenticated users to upload images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'images' AND (
    -- profile-pictures/{userId}-...: solo el propio usuario
    (
      (storage.foldername(name))[1] = 'profile-pictures'
      AND substring(split_part(name, '/', 2) from 1 for 36) = auth.uid()::text
    )
    OR
    -- destinations: admin, super_admin o agencia (contenido curado compartido)
    (
      (storage.foldername(name))[1] = 'destinations'
      AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid()
        AND users.role = ANY (ARRAY['admin','super_admin','agency'])
      )
    )
    OR
    -- newsletter-...: solo admin/super_admin (editor de texto enriquecido)
    (
      name LIKE 'newsletter-%'
      AND EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid()
        AND users.role = ANY (ARRAY['admin','super_admin'])
      )
    )
    OR
    -- tours/{agencyId}/... y agencies/{agencyId}/...: solo la agencia dueña
    (
      (storage.foldername(name))[1] = ANY (ARRAY['tours','agencies'])
      AND (storage.foldername(name))[2] IN (
        SELECT agencies.id::text FROM agencies WHERE agencies.user_id = auth.uid()
      )
    )
    OR
    -- Fallback: admin/super_admin pueden subir a cualquier ruta de este bucket
    -- (cubre rutas administrativas no listadas arriba)
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = ANY (ARRAY['admin','super_admin'])
    )
  )
)
;
