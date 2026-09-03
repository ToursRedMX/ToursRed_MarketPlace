-- 1. Agregar campos fiscales para extranjeros en tabla users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'num_reg_id_trib'
  ) THEN
    ALTER TABLE users ADD COLUMN num_reg_id_trib text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'residencia_fiscal'
  ) THEN
    ALTER TABLE users ADD COLUMN residencia_fiscal text;
  END IF;
END $$;

-- 2. Actualizar CHECK constraint de invoice_type en cfdi_invoices para incluir 'membership'
DO $$
BEGIN
  ALTER TABLE cfdi_invoices DROP CONSTRAINT IF EXISTS cfdi_invoices_invoice_type_check;
  ALTER TABLE cfdi_invoices ADD CONSTRAINT cfdi_invoices_invoice_type_check
    CHECK (invoice_type IN ('booking', 'commission', 'membership'));
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- 3. Agregar membership_id a cfdi_invoices
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cfdi_invoices' AND column_name = 'membership_id'
  ) THEN
    ALTER TABLE cfdi_invoices ADD COLUMN membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Agregar stripe_invoice_id a cfdi_invoices para idempotencia en renovaciones
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cfdi_invoices' AND column_name = 'stripe_invoice_id'
  ) THEN
    ALTER TABLE cfdi_invoices ADD COLUMN stripe_invoice_id text;
  END IF;
END $$;

-- 5. Índice para búsquedas por membership_id
CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_membership_id ON cfdi_invoices(membership_id);

-- 6. Índice para idempotencia por stripe_invoice_id
CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_stripe_invoice_id ON cfdi_invoices(stripe_invoice_id);

-- 7. Política RLS: el viajero puede ver sus propias facturas de membresía
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cfdi_invoices' AND policyname = 'Travelers can view their membership cfdi invoices'
  ) THEN
    CREATE POLICY "Travelers can view their membership cfdi invoices"
      ON cfdi_invoices FOR SELECT
      TO authenticated
      USING (
        membership_id IN (
          SELECT id FROM memberships
          WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;
