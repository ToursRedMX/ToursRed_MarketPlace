
-- Crear bucket para comprobantes de pago si no existe
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-receipts',
  'payment-receipts',
  false,
  5242880, -- 5MB
  ARRAY['image/jpeg', 'image/png', 'image/jpg', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Política: Solo admin puede subir comprobantes
DROP POLICY IF EXISTS "Admin can upload payment receipts" ON storage.objects;
CREATE POLICY "Admin can upload payment receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'payment-receipts'
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'super_admin')
  )
);

-- Política: Admin puede ver todos los comprobantes
DROP POLICY IF EXISTS "Admin can view all payment receipts" ON storage.objects;
CREATE POLICY "Admin can view all payment receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'payment-receipts'
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'super_admin')
  )
);

-- Política: Agencias pueden ver sus propios comprobantes
DROP POLICY IF EXISTS "Agencies can view own payment receipts" ON storage.objects;
CREATE POLICY "Agencies can view own payment receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'payment-receipts'
  AND EXISTS (
    SELECT 1 
    FROM commission_records cr
    INNER JOIN agencies a ON a.id = cr.agency_id
    WHERE cr.payment_receipt_url LIKE '%' || storage.objects.name || '%'
    AND a.user_id = auth.uid()
  )
);

-- Política: Admin puede eliminar comprobantes
DROP POLICY IF EXISTS "Admin can delete payment receipts" ON storage.objects;
CREATE POLICY "Admin can delete payment receipts"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'payment-receipts'
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'super_admin')
  )
);
