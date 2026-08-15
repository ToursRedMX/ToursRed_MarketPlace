-- 1. Nuevas columnas en cfdi_invoices

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='cfdi_invoices' AND column_name='is_manual') THEN
    ALTER TABLE cfdi_invoices ADD COLUMN is_manual boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='cfdi_invoices' AND column_name='cfdi_type') THEN
    ALTER TABLE cfdi_invoices ADD COLUMN cfdi_type text CHECK (cfdi_type IN ('I','E','P'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='cfdi_invoices' AND column_name='payment_method_sat') THEN
    ALTER TABLE cfdi_invoices ADD COLUMN payment_method_sat text CHECK (payment_method_sat IN ('PUE','PPD'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='cfdi_invoices' AND column_name='source_notes') THEN
    ALTER TABLE cfdi_invoices ADD COLUMN source_notes text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='cfdi_invoices' AND column_name='accounting_account_code') THEN
    ALTER TABLE cfdi_invoices ADD COLUMN accounting_account_code text REFERENCES chart_of_accounts(code);
  END IF;
END $$;

-- Ampliar constraint de invoice_type para incluir 'manual'
-- (eliminamos y recreamos el constraint)
DO $$
BEGIN
  ALTER TABLE cfdi_invoices DROP CONSTRAINT IF EXISTS cfdi_invoices_invoice_type_check;
  ALTER TABLE cfdi_invoices
    ADD CONSTRAINT cfdi_invoices_invoice_type_check
    CHECK (invoice_type IN ('booking','commission','membership','manual'));
EXCEPTION WHEN others THEN
  NULL; -- Si falla por filas existentes fuera del rango, ignorar (no deberia pasar)
END $$;

-- 2. Tabla manual_cfdi_recipients

CREATE TABLE IF NOT EXISTS manual_cfdi_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  rfc           text NOT NULL,
  razon_social  text NOT NULL,
  regimen_fiscal text NOT NULL DEFAULT '601',
  uso_cfdi      text NOT NULL DEFAULT 'G03',
  codigo_postal text NOT NULL,
  email         text,
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS manual_cfdi_recipients_rfc_key ON manual_cfdi_recipients(rfc);

ALTER TABLE manual_cfdi_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view manual cfdi recipients"
  ON manual_cfdi_recipients FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin','super_admin')
    )
  );

CREATE POLICY "Admins can insert manual cfdi recipients"
  ON manual_cfdi_recipients FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin','super_admin')
    )
  );

CREATE POLICY "Admins can update manual cfdi recipients"
  ON manual_cfdi_recipients FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin','super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin','super_admin')
    )
  );

CREATE POLICY "Admins can delete manual cfdi recipients"
  ON manual_cfdi_recipients FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role IN ('admin','super_admin')
    )
  );

-- 3. Funcion RPC: asiento contable para CFDI manual

CREATE OR REPLACE FUNCTION create_accounting_entry_for_manual_cfdi(p_cfdi_invoice_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfdi        record;
  v_entry_id    uuid;
  v_entry_number text;
  v_year        integer;
  v_month       integer;
  v_entry_type  text;
  v_description text;
  v_line        integer := 1;
  v_bank_account text := '102';
BEGIN
  -- Verificar que no exista ya un asiento para este CFDI manual
  IF EXISTS (
    SELECT 1 FROM accounting_entries ae
    JOIN accounting_entry_lines al ON al.entry_id = ae.id
    WHERE al.cfdi_uuid = (SELECT uuid_fiscal FROM cfdi_invoices WHERE id = p_cfdi_invoice_id)
      AND ae.source_type = 'manual'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_cfdi
  FROM cfdi_invoices
  WHERE id = p_cfdi_invoice_id AND status = 'stamped';

  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_cfdi.cfdi_type IS NULL THEN RETURN NULL; END IF;

  v_year  := EXTRACT(YEAR  FROM COALESCE(v_cfdi.stamped_at, v_cfdi.created_at))::integer;
  v_month := EXTRACT(MONTH FROM COALESCE(v_cfdi.stamped_at, v_cfdi.created_at))::integer;

  -- Tipo de poliza segun tipo de comprobante
  CASE v_cfdi.cfdi_type
    WHEN 'I' THEN
      v_entry_type  := 'ingreso';
      v_description := 'Factura manual ingreso — ' || COALESCE(v_cfdi.receptor_razon_social, v_cfdi.receptor_rfc);
    WHEN 'E' THEN
      v_entry_type  := 'egreso';
      v_description := 'Nota de credito manual — ' || COALESCE(v_cfdi.receptor_razon_social, v_cfdi.receptor_rfc);
    WHEN 'P' THEN
      v_entry_type  := 'diario';
      v_description := 'Complemento de pago — ' || COALESCE(v_cfdi.receptor_razon_social, v_cfdi.receptor_rfc);
  END CASE;

  IF v_cfdi.folio IS NOT NULL THEN
    v_description := v_description || ' — ' || COALESCE(v_cfdi.serie,'') || v_cfdi.folio;
  END IF;

  v_entry_number := generate_entry_number(v_entry_type, v_year, v_month);

  INSERT INTO accounting_entries (
    entry_number, entry_type, entry_date, period_year, period_month,
    description, source_type, source_id, is_posted
  ) VALUES (
    v_entry_number,
    v_entry_type,
    COALESCE(v_cfdi.stamped_at::date, v_cfdi.created_at::date),
    v_year,
    v_month,
    v_description,
    'manual',
    p_cfdi_invoice_id,
    true
  )
  RETURNING id INTO v_entry_id;

  -- Asiento segun tipo
  IF v_cfdi.cfdi_type = 'I' THEN
    -- Ingreso: Debito Bancos / Credito cuenta de ingreso
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line, v_bank_account,
      'Cobro ' || COALESCE(v_cfdi.receptor_razon_social, v_cfdi.receptor_rfc),
      v_cfdi.total, 0, v_cfdi.uuid_fiscal);
    v_line := v_line + 1;

    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line, COALESCE(v_cfdi.accounting_account_code, '407'),
      v_description,
      0, v_cfdi.subtotal, v_cfdi.uuid_fiscal);
    v_line := v_line + 1;

    -- IVA trasladado (si aplica)
    IF COALESCE(v_cfdi.iva_amount, 0) > 0 THEN
      INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
      VALUES (v_entry_id, v_line, '213',
        'IVA trasladado — ' || COALESCE(v_cfdi.folio,''),
        0, v_cfdi.iva_amount, v_cfdi.uuid_fiscal);
    END IF;

  ELSIF v_cfdi.cfdi_type = 'E' THEN
    -- Egreso (nota de credito): Debito cuenta de ingreso / Credito Bancos
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line, COALESCE(v_cfdi.accounting_account_code, '407'),
      v_description,
      v_cfdi.subtotal, 0, v_cfdi.uuid_fiscal);
    v_line := v_line + 1;

    IF COALESCE(v_cfdi.iva_amount, 0) > 0 THEN
      INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
      VALUES (v_entry_id, v_line, '213',
        'IVA por devolucion — ' || COALESCE(v_cfdi.folio,''),
        v_cfdi.iva_amount, 0, v_cfdi.uuid_fiscal);
      v_line := v_line + 1;
    END IF;

    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line, v_bank_account,
      'Devolucion ' || COALESCE(v_cfdi.receptor_razon_social, v_cfdi.receptor_rfc),
      0, v_cfdi.total, v_cfdi.uuid_fiscal);

  ELSIF v_cfdi.cfdi_type = 'P' THEN
    -- Complemento de pago: Debito cuenta 208 (anticipos) / Credito Bancos
    -- Si no hay cuenta de anticipos, usa la cuenta seleccionada
    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line, COALESCE(v_cfdi.accounting_account_code, '208'),
      'Aplicacion de pago — ' || COALESCE(v_cfdi.receptor_razon_social, v_cfdi.receptor_rfc),
      v_cfdi.total, 0, v_cfdi.uuid_fiscal);
    v_line := v_line + 1;

    INSERT INTO accounting_entry_lines (entry_id, line_number, account_code, description, debit, credit, cfdi_uuid)
    VALUES (v_entry_id, v_line, v_bank_account,
      'Pago recibido — ' || COALESCE(v_cfdi.folio,''),
      0, v_cfdi.total, v_cfdi.uuid_fiscal);
  END IF;

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_accounting_entry_for_manual_cfdi(uuid) TO authenticated;

-- Asegurar que cuenta 213 (IVA Trasladado) exista en el catalogo
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, nature, level, parent_code, is_system, is_active, description)
VALUES ('213', '213-01', 'IVA Trasladado por Cobrar', 'pasivo', 'acreedora', 3, '21', false, true,
  'IVA 16% trasladado en facturas emitidas, pendiente de entero al SAT')
ON CONFLICT (code) DO NOTHING;
