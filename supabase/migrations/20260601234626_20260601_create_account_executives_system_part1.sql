-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TABLA: account_executives
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_executives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  hired_at TIMESTAMPTZ DEFAULT now(),
  terminated_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE account_executives ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_account_executives_user_id ON account_executives(user_id);
CREATE INDEX IF NOT EXISTS idx_account_executives_email ON account_executives(email);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TABLA: executive_commission_settings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS executive_commission_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_per_approval DECIMAL(10,2) NOT NULL DEFAULT 100.00,
  amount_per_first_booking DECIMAL(10,2) NOT NULL DEFAULT 100.00,
  platform_revenue_percentage DECIMAL(5,2) NOT NULL DEFAULT 3.00,
  commission_period_months INTEGER NOT NULL DEFAULT 3,
  is_current BOOLEAN DEFAULT true,
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE executive_commission_settings ENABLE ROW LEVEL SECURITY;

-- Solo puede existir un registro activo
CREATE UNIQUE INDEX IF NOT EXISTS idx_executive_commission_settings_current
  ON executive_commission_settings(is_current)
  WHERE is_current = true;

-- Insertar configuración por defecto
INSERT INTO executive_commission_settings (
  amount_per_approval,
  amount_per_first_booking,
  platform_revenue_percentage,
  commission_period_months,
  is_current
) VALUES (100.00, 100.00, 3.00, 3, true)
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TABLA: executive_bonus_rules
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS executive_bonus_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  condition_type TEXT NOT NULL CHECK (condition_type IN ('agencies_approved_count', 'revenue_generated', 'bookings_generated')),
  threshold_value DECIMAL(12,2) NOT NULL,
  bonus_amount DECIMAL(10,2) NOT NULL,
  is_recurring BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE executive_bonus_rules ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. TABLA: agency_leads
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agency_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  executive_id UUID NOT NULL REFERENCES account_executives(id) ON DELETE RESTRICT,
  -- Datos de la agencia prospecto (mismo esquema que agencies)
  agency_name TEXT NOT NULL,
  contact_first_name TEXT NOT NULL,
  contact_last_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  website TEXT,
  rfc TEXT,
  razon_social TEXT,
  rnt TEXT,
  street TEXT,
  exterior_number TEXT,
  interior_number TEXT,
  colony TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'México',
  banco TEXT,
  cuenta_clabe TEXT,
  titular_cuenta TEXT,
  -- Campos CRM
  status TEXT NOT NULL DEFAULT 'prospecto'
    CHECK (status IN ('prospecto', 'contactado', 'negociacion', 'registrado', 'aprobado', 'perdido')),
  notes TEXT,
  next_contact_date DATE,
  probability INTEGER DEFAULT 50 CHECK (probability BETWEEN 0 AND 100),
  source TEXT,
  -- Referencia a la agencia una vez convertido
  converted_agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  -- Historial de seguimiento (JSON array de notas)
  follow_up_log JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE agency_leads ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agency_leads_executive_id ON agency_leads(executive_id);
CREATE INDEX IF NOT EXISTS idx_agency_leads_status ON agency_leads(status);
CREATE INDEX IF NOT EXISTS idx_agency_leads_converted_agency_id ON agency_leads(converted_agency_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. TABLA: executive_commissions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS executive_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  executive_id UUID NOT NULL REFERENCES account_executives(id) ON DELETE RESTRICT,
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE RESTRICT,
  commission_type TEXT NOT NULL
    CHECK (commission_type IN ('approval', 'first_tour_and_booking', 'platform_period')),
  amount DECIMAL(10,2) NOT NULL,
  -- Para comisiones de periodo, registrar el mes/año
  period_month INTEGER CHECK (period_month BETWEEN 1 AND 12),
  period_year INTEGER,
  -- Referencias
  commission_settings_snapshot JSONB,
  -- Estado del flujo de cobro
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'invoiced', 'approved', 'paid', 'rejected')),
  -- CFDI que sube el ejecutivo para cobrar
  cfdi_xml_url TEXT,
  cfdi_pdf_url TEXT,
  cfdi_uuid_fiscal TEXT,
  cfdi_total DECIMAL(10,2),
  cfdi_uploaded_at TIMESTAMPTZ,
  -- Aprobación/pago por admin
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  paid_by UUID REFERENCES auth.users(id),
  paid_at TIMESTAMPTZ,
  payment_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE executive_commissions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_executive_commissions_executive_id ON executive_commissions(executive_id);
CREATE INDEX IF NOT EXISTS idx_executive_commissions_agency_id ON executive_commissions(agency_id);
CREATE INDEX IF NOT EXISTS idx_executive_commissions_status ON executive_commissions(status);
CREATE INDEX IF NOT EXISTS idx_executive_commissions_type ON executive_commissions(commission_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. TABLA: executive_bonus_awards
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS executive_bonus_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  executive_id UUID NOT NULL REFERENCES account_executives(id) ON DELETE RESTRICT,
  bonus_rule_id UUID NOT NULL REFERENCES executive_bonus_rules(id) ON DELETE RESTRICT,
  amount DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'invoiced', 'approved', 'paid')),
  awarded_at TIMESTAMPTZ DEFAULT now(),
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE executive_bonus_awards ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_executive_bonus_awards_executive_id ON executive_bonus_awards(executive_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. EXTENSIONES A TABLA agencies
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agencies' AND column_name = 'account_executive_id') THEN
    ALTER TABLE agencies ADD COLUMN account_executive_id UUID REFERENCES account_executives(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agencies' AND column_name = 'registered_by_executive') THEN
    ALTER TABLE agencies ADD COLUMN registered_by_executive BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agencies' AND column_name = 'signed_contract_url') THEN
    ALTER TABLE agencies ADD COLUMN signed_contract_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agencies' AND column_name = 'approval_period_start') THEN
    ALTER TABLE agencies ADD COLUMN approval_period_start TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agencies' AND column_name = 'first_tour_published_at') THEN
    ALTER TABLE agencies ADD COLUMN first_tour_published_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'agencies' AND column_name = 'first_paid_booking_at') THEN
    ALTER TABLE agencies ADD COLUMN first_paid_booking_at TIMESTAMPTZ;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agencies_account_executive_id ON agencies(account_executive_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. EXTENSIÓN A admin_permissions
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'admin_permissions' AND column_name = 'can_manage_executives') THEN
    ALTER TABLE admin_permissions ADD COLUMN can_manage_executives BOOLEAN DEFAULT false;
  END IF;
END $$;
