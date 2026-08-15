-- =============================================
-- 1. CREAR TABLA: accounting_sync_log
-- =============================================
CREATE TABLE IF NOT EXISTS accounting_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  record_type text NOT NULL CHECK (record_type IN ('contact_agency', 'contact_traveler', 'booking', 'payout', 'commission', 'journal_entry', 'gift_card')),
  record_id uuid NOT NULL,
  external_entity_type text,
  external_entity_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'error', 'skipped')),
  error_message text,
  synced_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  payload_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE accounting_sync_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_accounting_sync_log_provider ON accounting_sync_log(provider);
CREATE INDEX IF NOT EXISTS idx_accounting_sync_log_record_type ON accounting_sync_log(record_type);
CREATE INDEX IF NOT EXISTS idx_accounting_sync_log_record_id ON accounting_sync_log(record_id);
CREATE INDEX IF NOT EXISTS idx_accounting_sync_log_status ON accounting_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_accounting_sync_log_created_at ON accounting_sync_log(created_at DESC);

-- =============================================
-- 2. CREAR TABLA: accounting_account_mapping
-- =============================================
CREATE TABLE IF NOT EXISTS accounting_account_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  account_key text NOT NULL,
  external_account_id text NOT NULL,
  external_account_name text,
  account_type text NOT NULL CHECK (account_type IN ('income', 'expense', 'asset', 'liability', 'equity', 'bank', 'tax')),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, account_key)
);

ALTER TABLE accounting_account_mapping ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_accounting_account_mapping_provider ON accounting_account_mapping(provider);
CREATE INDEX IF NOT EXISTS idx_accounting_account_mapping_account_key ON accounting_account_mapping(account_key);

-- =============================================
-- 3. CREAR TABLA: zoho_oauth_tokens
-- =============================================
CREATE TABLE IF NOT EXISTS zoho_oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  scope text,
  token_type text NOT NULL DEFAULT 'Bearer',
  api_domain text NOT NULL DEFAULT 'https://www.zohoapis.com',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE zoho_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 4. AGREGAR CAMPOS CONTABLES A platform_settings
-- =============================================
DO $$
BEGIN
  -- Proveedor contable activo
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'accounting_provider') THEN
    ALTER TABLE platform_settings ADD COLUMN accounting_provider text NOT NULL DEFAULT 'none';
  END IF;
  -- Toggle global de sincronizacion
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'accounting_sync_enabled') THEN
    ALTER TABLE platform_settings ADD COLUMN accounting_sync_enabled boolean NOT NULL DEFAULT false;
  END IF;
  -- Credenciales Zoho Books
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'zoho_client_id') THEN
    ALTER TABLE platform_settings ADD COLUMN zoho_client_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'zoho_client_secret') THEN
    ALTER TABLE platform_settings ADD COLUMN zoho_client_secret text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'zoho_org_id') THEN
    ALTER TABLE platform_settings ADD COLUMN zoho_org_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'zoho_region') THEN
    ALTER TABLE platform_settings ADD COLUMN zoho_region text NOT NULL DEFAULT 'com';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_settings' AND column_name = 'zoho_sandbox_mode') THEN
    ALTER TABLE platform_settings ADD COLUMN zoho_sandbox_mode boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- Agregar constraint de proveedor contable
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_accounting_provider_check') THEN
    ALTER TABLE platform_settings ADD CONSTRAINT platform_settings_accounting_provider_check
      CHECK (accounting_provider IN ('none', 'zoho_books', 'odoo', 'quickbooks', 'contpaqi_cloud'));
  END IF;
END $$;

-- Actualizar constraint de pac_provider para incluir zoho_books
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_settings_pac_provider_check') THEN
    ALTER TABLE platform_settings DROP CONSTRAINT platform_settings_pac_provider_check;
  END IF;
  ALTER TABLE platform_settings ADD CONSTRAINT platform_settings_pac_provider_check
    CHECK (pac_provider IN ('none', 'facturapi', 'sw_sapien', 'contpaqi', 'zoho_books'));
END $$;

-- =============================================
-- 5. RLS POLICIES: accounting_sync_log
-- =============================================

CREATE POLICY "Admins can view accounting sync log"
  ON accounting_sync_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Service role can insert accounting sync log"
  ON accounting_sync_log FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update accounting sync log"
  ON accounting_sync_log FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can insert accounting sync log"
  ON accounting_sync_log FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can update accounting sync log"
  ON accounting_sync_log FOR UPDATE
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
-- 6. RLS POLICIES: accounting_account_mapping
-- =============================================

CREATE POLICY "Admins can view account mappings"
  ON accounting_account_mapping FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can insert account mappings"
  ON accounting_account_mapping FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can update account mappings"
  ON accounting_account_mapping FOR UPDATE
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

CREATE POLICY "Admins can delete account mappings"
  ON accounting_account_mapping FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Service role can manage account mappings"
  ON accounting_account_mapping FOR INSERT
  TO service_role
  WITH CHECK (true);

-- =============================================
-- 7. RLS POLICIES: zoho_oauth_tokens (solo service_role)
-- =============================================

CREATE POLICY "Service role can manage zoho tokens"
  ON zoho_oauth_tokens FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert zoho tokens"
  ON zoho_oauth_tokens FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update zoho tokens"
  ON zoho_oauth_tokens FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete zoho tokens"
  ON zoho_oauth_tokens FOR DELETE
  TO service_role
  USING (true);

-- =============================================
-- 8. TRIGGERS: updated_at
-- =============================================

CREATE OR REPLACE FUNCTION update_accounting_sync_log_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_accounting_sync_log_updated_at_trigger') THEN
    CREATE TRIGGER update_accounting_sync_log_updated_at_trigger
      BEFORE UPDATE ON accounting_sync_log
      FOR EACH ROW EXECUTE FUNCTION update_accounting_sync_log_updated_at();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION update_zoho_oauth_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_zoho_oauth_tokens_updated_at_trigger') THEN
    CREATE TRIGGER update_zoho_oauth_tokens_updated_at_trigger
      BEFORE UPDATE ON zoho_oauth_tokens
      FOR EACH ROW EXECUTE FUNCTION update_zoho_oauth_tokens_updated_at();
  END IF;
END $$;

-- =============================================
-- 9. FUNCION HELPER: get_accounting_sync_stats
-- =============================================

CREATE OR REPLACE FUNCTION get_accounting_sync_stats()
RETURNS TABLE (
  provider text,
  total_synced bigint,
  total_pending bigint,
  total_errors bigint,
  total_skipped bigint,
  contacts_synced bigint,
  bookings_synced bigint,
  payouts_synced bigint,
  last_sync_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    asl.provider,
    COUNT(*) FILTER (WHERE asl.status = 'synced') AS total_synced,
    COUNT(*) FILTER (WHERE asl.status = 'pending') AS total_pending,
    COUNT(*) FILTER (WHERE asl.status = 'error') AS total_errors,
    COUNT(*) FILTER (WHERE asl.status = 'skipped') AS total_skipped,
    COUNT(*) FILTER (WHERE asl.status = 'synced' AND asl.record_type IN ('contact_agency', 'contact_traveler')) AS contacts_synced,
    COUNT(*) FILTER (WHERE asl.status = 'synced' AND asl.record_type = 'booking') AS bookings_synced,
    COUNT(*) FILTER (WHERE asl.status = 'synced' AND asl.record_type IN ('payout', 'commission')) AS payouts_synced,
    MAX(asl.synced_at) FILTER (WHERE asl.status = 'synced') AS last_sync_at
  FROM accounting_sync_log asl
  GROUP BY asl.provider;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================
-- 10. POBLAR MAPEO DE CUENTAS INICIAL PARA ZOHO BOOKS
-- Basado en el modelo contable de ToursRed
-- Los IDs de cuentas son los numeros contables standard; se actualizan con los IDs reales de Zoho
-- =============================================

INSERT INTO accounting_account_mapping (provider, account_key, external_account_id, external_account_name, account_type, description)
VALUES
  ('zoho_books', 'ingresos_tours', '4001', 'Ingresos por Tours', 'income', 'Ingresos por venta de tours a viajeros'),
  ('zoho_books', 'ingresos_cargo_servicio', '4002', 'Cargo por Servicio de Plataforma', 'income', 'Comision/cargo de servicio cobrado al viajero por uso de la plataforma'),
  ('zoho_books', 'ingresos_membresias', '4003', 'Ingresos por Membresias', 'income', 'Ingresos por suscripciones ToursRed Plus'),
  ('zoho_books', 'ingresos_gift_cards', '4004', 'Ingresos por Gift Cards', 'income', 'Ingresos por venta de tarjetas de regalo'),
  ('zoho_books', 'comisiones_agencias', '5001', 'Comisiones pagadas a Agencias', 'expense', 'Pago de comisiones a agencias por tours realizados'),
  ('zoho_books', 'bonos_referidos', '5002', 'Bonos por Referidos', 'expense', 'Puntos/cashback otorgados por programa de referidos'),
  ('zoho_books', 'cuentas_por_cobrar', '1101', 'Cuentas por Cobrar Viajeros', 'asset', 'Saldo pendiente de cobrar a viajeros'),
  ('zoho_books', 'cuentas_por_pagar_agencias', '2101', 'Cuentas por Pagar Agencias', 'liability', 'Saldo a pagar a agencias por tours realizados'),
  ('zoho_books', 'iva_trasladado', '2201', 'IVA Trasladado por Pagar', 'liability', 'IVA 16% cobrado al viajero y pendiente de enterar al SAT'),
  ('zoho_books', 'iva_acreditable', '1201', 'IVA Acreditable', 'asset', 'IVA pagado a proveedores y acreditable contra IVA trasladado'),
  ('zoho_books', 'banco_principal', '1001', 'Banco - Cuenta Principal', 'bank', 'Cuenta bancaria principal de operaciones'),
  ('zoho_books', 'toursred_cash_liability', '2102', 'Saldo ToursRed Cash por Pagar', 'liability', 'Saldo de ToursRed Cash activo en wallets de viajeros'),
  ('zoho_books', 'puntos_liability', '2103', 'Puntos ToursRed por Redimir', 'liability', 'Valor de puntos acumulados por viajeros aun no redimidos')
ON CONFLICT (provider, account_key) DO NOTHING;
