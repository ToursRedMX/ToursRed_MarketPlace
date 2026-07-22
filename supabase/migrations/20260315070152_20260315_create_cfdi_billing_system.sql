-- =============================================
-- 1. ADD FISCAL FIELDS TO users TABLE
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'rfc') THEN
    ALTER TABLE users ADD COLUMN rfc text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'razon_social') THEN
    ALTER TABLE users ADD COLUMN razon_social text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'regimen_fiscal') THEN
    ALTER TABLE users ADD COLUMN regimen_fiscal text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'uso_cfdi') THEN
    ALTER TABLE users ADD COLUMN uso_cfdi text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'codigo_postal_fiscal') THEN
    ALTER TABLE users ADD COLUMN codigo_postal_fiscal text;
  END IF;
END $$;

-- =============================================
-- 2. ADD FISCAL FIELDS TO agencies TABLE
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agencies' AND column_name = 'rfc') THEN
    ALTER TABLE agencies ADD COLUMN rfc text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agencies' AND column_name = 'razon_social') THEN
    ALTER TABLE agencies ADD COLUMN razon_social text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agencies' AND column_name = 'regimen_fiscal') THEN
    ALTER TABLE agencies ADD COLUMN regimen_fiscal text;
  END IF;
END $$;

-- =============================================
-- 3. ADD PAC CONFIGURATION TO platform_settings
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'pac_provider') THEN
    ALTER TABLE platform_settings ADD COLUMN pac_provider text NOT NULL DEFAULT 'none';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'pac_api_key_encrypted') THEN
    ALTER TABLE platform_settings ADD COLUMN pac_api_key_encrypted text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'pac_organization_id') THEN
    ALTER TABLE platform_settings ADD COLUMN pac_organization_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'cfdi_serie_booking') THEN
    ALTER TABLE platform_settings ADD COLUMN cfdi_serie_booking text NOT NULL DEFAULT 'A';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'cfdi_serie_commission') THEN
    ALTER TABLE platform_settings ADD COLUMN cfdi_serie_commission text NOT NULL DEFAULT 'B';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'pac_sandbox_mode') THEN
    ALTER TABLE platform_settings ADD COLUMN pac_sandbox_mode boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'pac_issuer_rfc') THEN
    ALTER TABLE platform_settings ADD COLUMN pac_issuer_rfc text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'pac_issuer_razon_social') THEN
    ALTER TABLE platform_settings ADD COLUMN pac_issuer_razon_social text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'pac_issuer_regimen_fiscal') THEN
    ALTER TABLE platform_settings ADD COLUMN pac_issuer_regimen_fiscal text;
  END IF;
END $$;

-- Add check constraint for pac_provider
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_pac_provider_check') THEN
    ALTER TABLE platform_settings ADD CONSTRAINT platform_settings_pac_provider_check
      CHECK (pac_provider IN ('none', 'facturapi', 'sw_sapien', 'contpaqi'));
  END IF;
END $$;

-- =============================================
-- 4. CREATE cfdi_invoices TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS cfdi_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_type text NOT NULL CHECK (invoice_type IN ('booking', 'commission')),
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  payout_id uuid REFERENCES agency_payouts(id) ON DELETE SET NULL,
  agency_id uuid REFERENCES agencies(id) ON DELETE SET NULL,
  pac_provider text NOT NULL DEFAULT 'facturapi',
  pac_invoice_id text,
  uuid_fiscal text,
  folio text,
  serie text,
  receptor_rfc text NOT NULL DEFAULT 'XAXX010101000',
  receptor_razon_social text,
  receptor_regimen_fiscal text DEFAULT '616',
  receptor_uso_cfdi text DEFAULT 'S01',
  receptor_codigo_postal text,
  subtotal numeric(12, 2) NOT NULL DEFAULT 0,
  iva_amount numeric(12, 2) NOT NULL DEFAULT 0,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'MXN',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'stamped', 'cancelled', 'error')),
  xml_url text,
  pdf_url text,
  stamped_at timestamptz,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  email_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cfdi_invoices ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_booking_id ON cfdi_invoices(booking_id);
CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_payout_id ON cfdi_invoices(payout_id);
CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_agency_id ON cfdi_invoices(agency_id);
CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_status ON cfdi_invoices(status);
CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_invoice_type ON cfdi_invoices(invoice_type);
CREATE INDEX IF NOT EXISTS idx_cfdi_invoices_uuid_fiscal ON cfdi_invoices(uuid_fiscal) WHERE uuid_fiscal IS NOT NULL;

-- =============================================
-- 5. CREATE cfdi_cancellation_requests TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS cfdi_cancellation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cfdi_invoice_id uuid NOT NULL REFERENCES cfdi_invoices(id) ON DELETE CASCADE,
  motivo text NOT NULL CHECK (motivo IN ('01', '02', '03', '04')),
  uuid_sustitucion text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  pac_cancellation_id text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error_message text
);

ALTER TABLE cfdi_cancellation_requests ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_cfdi_cancellations_invoice_id ON cfdi_cancellation_requests(cfdi_invoice_id);
CREATE INDEX IF NOT EXISTS idx_cfdi_cancellations_status ON cfdi_cancellation_requests(status);

-- =============================================
-- 6. RLS POLICIES FOR cfdi_invoices
-- =============================================

-- Admins can view all CFDI records
CREATE POLICY "Admins can view all cfdi invoices"
  ON cfdi_invoices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  );

-- Agencies can view their own CFDI records
CREATE POLICY "Agencies can view their own cfdi invoices"
  ON cfdi_invoices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = cfdi_invoices.agency_id
      AND agencies.user_id = auth.uid()
    )
  );

-- Travelers can view CFDI for their bookings
CREATE POLICY "Travelers can view cfdi for their bookings"
  ON cfdi_invoices FOR SELECT
  TO authenticated
  USING (
    cfdi_invoices.invoice_type = 'booking'
    AND EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = cfdi_invoices.booking_id
      AND bookings.user_id = auth.uid()
    )
  );

-- Service role can insert/update (used by edge functions)
CREATE POLICY "Service role can insert cfdi invoices"
  ON cfdi_invoices FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update cfdi invoices"
  ON cfdi_invoices FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Admins can insert/update too (for manual operations)
CREATE POLICY "Admins can insert cfdi invoices"
  ON cfdi_invoices FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can update cfdi invoices"
  ON cfdi_invoices FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  );

-- =============================================
-- 7. RLS POLICIES FOR cfdi_cancellation_requests
-- =============================================

CREATE POLICY "Admins can view all cfdi cancellations"
  ON cfdi_cancellation_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can insert cfdi cancellations"
  ON cfdi_cancellation_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can update cfdi cancellations"
  ON cfdi_cancellation_requests FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Service role can insert cfdi cancellations"
  ON cfdi_cancellation_requests FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update cfdi cancellations"
  ON cfdi_cancellation_requests FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================
-- 8. TRIGGER: updated_at on cfdi_invoices
-- =============================================
CREATE OR REPLACE FUNCTION update_cfdi_invoice_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_cfdi_invoices_updated_at') THEN
    CREATE TRIGGER update_cfdi_invoices_updated_at
      BEFORE UPDATE ON cfdi_invoices
      FOR EACH ROW
      EXECUTE FUNCTION update_cfdi_invoice_updated_at();
  END IF;
END $$;

-- =============================================
-- 9. HELPER FUNCTION: get_cfdi_stats (for admin dashboard)
-- =============================================
CREATE OR REPLACE FUNCTION get_cfdi_stats()
RETURNS TABLE (
  total_stamped bigint,
  total_pending bigint,
  total_errors bigint,
  total_cancelled bigint,
  total_amount numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE status = 'stamped') AS total_stamped,
    COUNT(*) FILTER (WHERE status = 'pending') AS total_pending,
    COUNT(*) FILTER (WHERE status = 'error') AS total_errors,
    COUNT(*) FILTER (WHERE status = 'cancelled') AS total_cancelled,
    COALESCE(SUM(total) FILTER (WHERE status = 'stamped'), 0) AS total_amount
  FROM cfdi_invoices;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;
