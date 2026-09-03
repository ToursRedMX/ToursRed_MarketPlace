
-- Storage: corregir prefix check (15 chars, no 16)
DROP POLICY IF EXISTS "Executives can upload own CFDI files" ON storage.objects;
DROP POLICY IF EXISTS "Executives can view own CFDI files" ON storage.objects;

CREATE POLICY "Executives can upload own CFDI files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment-receipts'
    AND starts_with(name, 'executive-cfdi/')
    AND EXISTS (
      SELECT 1 FROM public.account_executives ae
      WHERE ae.user_id = auth.uid()
        AND ae.is_active = true
    )
  );

CREATE POLICY "Executives can view own CFDI files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-receipts'
    AND starts_with(name, 'executive-cfdi/')
    AND EXISTS (
      SELECT 1 FROM public.account_executives ae
      WHERE ae.user_id = auth.uid()
        AND ae.is_active = true
    )
  );

-- executive_commissions: permitir actualizar mientras sea pending o invoiced
-- (para re-subidas), solo verificar propiedad en WITH CHECK
DROP POLICY IF EXISTS "Executives can update own commissions to upload CFDI" ON executive_commissions;

CREATE POLICY "Executives can update own commissions to upload CFDI"
  ON executive_commissions FOR UPDATE
  TO authenticated
  USING (
    executive_id = get_executive_id_for_user(auth.uid())
    AND status IN ('pending', 'invoiced', 'rejected')
  )
  WITH CHECK (
    executive_id = get_executive_id_for_user(auth.uid())
  );
