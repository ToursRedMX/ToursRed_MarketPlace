-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830193731
--   name:    lock_down_unused_assets_bucket
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

-- El bucket 'assets' no se usa en ningun lado del codigo (solo tiene 1 archivo,
-- LogoFinal.jpg, subido el dia que se creo el bucket, sin dueno). Se deja de lectura
-- publica (por si algo externo referencia esa URL del logo) pero se cierra la subida
-- publica sin restriccion que tenia antes.
DROP POLICY IF EXISTS "Public can upload to assets" ON storage.objects;

CREATE POLICY "Only admins can upload to assets"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'assets'
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role = ANY (ARRAY['admin','super_admin'])
  )
)
;
