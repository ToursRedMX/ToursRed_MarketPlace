-- =============================================
-- CATALOGO DE CUENTAS
-- =============================================
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  sat_group_code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('activo', 'pasivo', 'capital', 'ingreso', 'gasto', 'costo')),
  parent_code text REFERENCES chart_of_accounts(code),
  level integer NOT NULL DEFAULT 3 CHECK (level BETWEEN 1 AND 4),
  nature text NOT NULL DEFAULT 'deudora' CHECK (nature IN ('deudora', 'acreedora')),
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  description text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and accountant can view chart of accounts"
  ON chart_of_accounts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'accountant')
    )
  );

CREATE POLICY "Admin can insert chart of accounts"
  ON chart_of_accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'accountant')
    )
  );

CREATE POLICY "Admin can update chart of accounts"
  ON chart_of_accounts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'accountant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'accountant')
    )
  );

-- =============================================
-- POLIZAS CONTABLES
-- =============================================
CREATE TABLE IF NOT EXISTS accounting_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number text UNIQUE NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('ingreso', 'egreso', 'diario')),
  entry_date date NOT NULL,
  period_year integer NOT NULL,
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  description text NOT NULL DEFAULT '',
  source_type text CHECK (source_type IN ('booking', 'payout', 'cancellation', 'manual', 'membership', 'gift_card')),
  source_id uuid,
  is_closing boolean NOT NULL DEFAULT false,
  is_posted boolean NOT NULL DEFAULT false,
  posted_at timestamptz,
  posted_by uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_entries_period ON accounting_entries(period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_accounting_entries_source ON accounting_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_accounting_entries_date ON accounting_entries(entry_date);

ALTER TABLE accounting_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and accountant can view accounting entries"
  ON accounting_entries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'accountant')
    )
  );

CREATE POLICY "Admin and accountant can insert accounting entries"
  ON accounting_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'accountant')
    )
  );

CREATE POLICY "Admin and accountant can update accounting entries"
  ON accounting_entries FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'accountant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'accountant')
    )
  );

-- =============================================
-- PARTIDAS DE POLIZAS
-- =============================================
CREATE TABLE IF NOT EXISTS accounting_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES accounting_entries(id) ON DELETE CASCADE,
  line_number integer NOT NULL DEFAULT 1,
  account_code text NOT NULL REFERENCES chart_of_accounts(code),
  description text NOT NULL DEFAULT '',
  debit numeric(12,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(12,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  cfdi_uuid text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entry_lines_entry_id ON accounting_entry_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_lines_account_code ON accounting_entry_lines(account_code);

ALTER TABLE accounting_entry_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and accountant can view entry lines"
  ON accounting_entry_lines FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'accountant')
    )
  );

CREATE POLICY "Admin and accountant can insert entry lines"
  ON accounting_entry_lines FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'accountant')
    )
  );

CREATE POLICY "Admin and accountant can update entry lines"
  ON accounting_entry_lines FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'accountant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role IN ('admin', 'accountant')
    )
  );

-- =============================================
-- SERVICE ROLE POLICIES (para Edge Functions)
-- =============================================
CREATE POLICY "Service role full access chart of accounts"
  ON chart_of_accounts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access accounting entries"
  ON accounting_entries FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access entry lines"
  ON accounting_entry_lines FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================
-- FUNCION: Secuencia de numeros de poliza
-- =============================================
CREATE OR REPLACE FUNCTION generate_entry_number(p_type text, p_year integer, p_month integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prefix text;
  seq integer;
BEGIN
  prefix := CASE p_type
    WHEN 'ingreso' THEN 'I'
    WHEN 'egreso'  THEN 'E'
    ELSE 'D'
  END;

  SELECT COALESCE(MAX(CAST(SPLIT_PART(entry_number, '-', 4) AS integer)), 0) + 1
  INTO seq
  FROM accounting_entries
  WHERE entry_type = p_type
    AND period_year = p_year
    AND period_month = p_month;

  RETURN prefix || '-' || p_year || '-' || LPAD(p_month::text, 2, '0') || '-' || LPAD(seq::text, 4, '0');
END;
$$;

-- =============================================
-- FUNCION: Verificar balance de poliza
-- =============================================
CREATE OR REPLACE FUNCTION check_entry_balance(p_entry_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_debit numeric;
  total_credit numeric;
BEGIN
  SELECT
    COALESCE(SUM(debit), 0),
    COALESCE(SUM(credit), 0)
  INTO total_debit, total_credit
  FROM accounting_entry_lines
  WHERE entry_id = p_entry_id;

  RETURN ABS(total_debit - total_credit) < 0.01;
END;
$$;

-- =============================================
-- PRE-POBLAR CATALOGO DE CUENTAS (RESICO 626)
-- =============================================

-- Nivel 1: Clases
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, level, nature, is_system) VALUES
('1', '100-00', 'ACTIVO', 'activo', 1, 'deudora', true),
('2', '200-00', 'PASIVO', 'pasivo', 1, 'acreedora', true),
('3', '300-00', 'CAPITAL', 'capital', 1, 'acreedora', true),
('4', '400-00', 'INGRESOS', 'ingreso', 1, 'acreedora', true),
('5', '500-00', 'COSTOS', 'costo', 1, 'deudora', true),
('6', '600-00', 'GASTOS', 'gasto', 1, 'deudora', true)
ON CONFLICT (code) DO NOTHING;

-- Nivel 2: Grupos
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system) VALUES
('10', '100-00', 'Activo Circulante', 'activo', '1', 2, 'deudora', true),
('11', '110-00', 'Activo No Circulante', 'activo', '1', 2, 'deudora', true),
('20', '200-00', 'Pasivo a Corto Plazo', 'pasivo', '2', 2, 'acreedora', true),
('21', '210-00', 'Pasivo a Largo Plazo', 'pasivo', '2', 2, 'acreedora', true),
('30', '300-00', 'Capital Contable', 'capital', '3', 2, 'acreedora', true),
('40', '400-00', 'Ingresos por Servicios', 'ingreso', '4', 2, 'acreedora', true),
('60', '600-00', 'Gastos de Operacion', 'gasto', '6', 2, 'deudora', true)
ON CONFLICT (code) DO NOTHING;

-- Nivel 3: Cuentas principales
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, description) VALUES
-- Activo circulante
('101', '102-01', 'Caja', 'activo', '10', 3, 'deudora', true, 'Efectivo en caja'),
('102', '102-02', 'Bancos', 'activo', '10', 3, 'deudora', true, 'Cuentas bancarias de la empresa'),
('105', '105-01', 'Clientes', 'activo', '10', 3, 'deudora', true, 'Cuentas por cobrar a viajeros'),
('106', '106-01', 'Otras cuentas por cobrar', 'activo', '10', 3, 'deudora', true, 'Otras cuentas por cobrar diversas'),
('108', '108-01', 'IVA Acreditable', 'activo', '10', 3, 'deudora', true, 'IVA pagado pendiente de acreditar'),
('109', '109-01', 'Pagos anticipados', 'activo', '10', 3, 'deudora', true, 'Gastos pagados por anticipado'),

-- Pasivo a corto plazo
('201', '201-01', 'Proveedores', 'pasivo', '20', 3, 'acreedora', true, 'Cuentas por pagar a agencias de viajes'),
('205', '205-01', 'Acreedores diversos', 'pasivo', '20', 3, 'acreedora', true, 'Otras cuentas por pagar'),
('208', '208-01', 'Anticipos de clientes', 'pasivo', '20', 3, 'acreedora', true, 'Depositos de viajeros pendientes de devengarse — pasivo hasta completar el tour'),
('210', '210-01', 'IVA Trasladado por enterar', 'pasivo', '20', 3, 'acreedora', true, 'IVA cobrado pendiente de pago al SAT'),
('213', '213-01', 'Impuestos por pagar', 'pasivo', '20', 3, 'acreedora', true, 'ISR y otros impuestos por enterar al SAT'),

-- Capital
('301', '301-01', 'Capital social', 'capital', '30', 3, 'acreedora', true, 'Aportaciones de socios'),
('302', '302-01', 'Utilidades retenidas', 'capital', '30', 3, 'acreedora', true, 'Utilidades de ejercicios anteriores'),
('303', '303-01', 'Utilidad / Perdida del ejercicio', 'capital', '30', 3, 'acreedora', true, 'Resultado del ejercicio en curso'),

-- Ingresos
('401', '401-01', 'Ingresos por comisiones', 'ingreso', '40', 3, 'acreedora', true, 'Comisiones propias de ToursRed por tours vendidos'),
('402', '402-01', 'Ingresos por cargo de servicio', 'ingreso', '40', 3, 'acreedora', true, 'Cargo de servicio de plataforma cobrado a viajeros'),
('403', '403-01', 'Ingresos por membresias', 'ingreso', '40', 3, 'acreedora', true, 'Membresias ToursRed Plus'),
('404', '404-01', 'Ingresos por tarjetas regalo', 'ingreso', '40', 3, 'acreedora', true, 'Venta de gift cards'),
('405', '405-01', 'Otros ingresos', 'ingreso', '40', 3, 'acreedora', true, 'Ingresos diversos'),

-- Gastos
('601', '601-01', 'Gastos de administracion', 'gasto', '60', 3, 'deudora', true, 'Gastos generales de administracion'),
('602', '602-01', 'Gastos de tecnologia', 'gasto', '60', 3, 'deudora', true, 'Servidores, software, plataformas digitales'),
('603', '603-01', 'Gastos de marketing', 'gasto', '60', 3, 'deudora', true, 'Publicidad y promocion'),
('604', '604-01', 'Comisiones bancarias y pasarelas', 'gasto', '60', 3, 'deudora', true, 'Comisiones de Stripe, MercadoPago, PayPal'),
('605', '605-01', 'Gastos financieros', 'gasto', '60', 3, 'deudora', true, 'Intereses y gastos bancarios'),
('606', '606-01', 'Reembolsos y cancelaciones', 'gasto', '60', 3, 'deudora', true, 'Costos por reembolsos a viajeros')
ON CONFLICT (code) DO NOTHING;
