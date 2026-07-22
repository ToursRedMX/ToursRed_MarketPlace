-- ─────────────────────────────────────────────────────────────────────────────
-- Nuevas columnas en account_executives
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'profile_photo_url') THEN
    ALTER TABLE account_executives ADD COLUMN profile_photo_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'tax_name') THEN
    ALTER TABLE account_executives ADD COLUMN tax_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'tax_rfc') THEN
    ALTER TABLE account_executives ADD COLUMN tax_rfc TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'tax_address') THEN
    ALTER TABLE account_executives ADD COLUMN tax_address TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'tax_zip') THEN
    ALTER TABLE account_executives ADD COLUMN tax_zip TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'bank_beneficiary') THEN
    ALTER TABLE account_executives ADD COLUMN bank_beneficiary TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'bank_name') THEN
    ALTER TABLE account_executives ADD COLUMN bank_name TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'bank_account_number') THEN
    ALTER TABLE account_executives ADD COLUMN bank_account_number TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_executives' AND column_name = 'bank_clabe') THEN
    ALTER TABLE account_executives ADD COLUMN bank_clabe TEXT;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Política UPDATE para que el ejecutivo edite su propio registro
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'account_executives' AND policyname = 'Executives can update own profile'
  ) THEN
    CREATE POLICY "Executives can update own profile"
      ON account_executives FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket privado para avatares de ejecutivos
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'executive-avatars',
  'executive-avatars',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Ejecutivo puede subir/reemplazar su propia foto
CREATE POLICY "Executives can upload own avatar"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'executive-avatars'
    AND EXISTS (
      SELECT 1 FROM public.account_executives ae
      WHERE ae.user_id = auth.uid() AND ae.is_active = true
    )
  );

CREATE POLICY "Executives can update own avatar"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'executive-avatars'
    AND EXISTS (
      SELECT 1 FROM public.account_executives ae
      WHERE ae.user_id = auth.uid() AND ae.is_active = true
    )
  );

CREATE POLICY "Executives can view own avatar"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'executive-avatars'
    AND EXISTS (
      SELECT 1 FROM public.account_executives ae
      WHERE ae.user_id = auth.uid() AND ae.is_active = true
    )
  );

-- Admins pueden ver todos los avatares de ejecutivos
CREATE POLICY "Admins can view executive avatars"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'executive-avatars'
    AND is_admin_with_executive_permission()
  );
