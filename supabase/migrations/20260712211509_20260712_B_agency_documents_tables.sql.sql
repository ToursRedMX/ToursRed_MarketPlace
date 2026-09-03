-- Migration B: document_types, agency_documents, contract_acceptances, fraud_blocklist

-- 1. Catalog of document types
CREATE TABLE IF NOT EXISTS document_types (
  key          text PRIMARY KEY,
  label        text NOT NULL,
  description  text,
  required     boolean NOT NULL DEFAULT true,
  sort_order   int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE document_types ENABLE ROW LEVEL SECURITY;

-- Public read (catalog)
CREATE POLICY "public_read_document_types" ON document_types
  FOR SELECT TO anon, authenticated USING (true);

-- Only admins can mutate (managed via SQL / admin tools)
CREATE POLICY "admin_all_document_types" ON document_types
  FOR ALL TO authenticated
  USING  ((SELECT role FROM users WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');

-- Seed required document types
INSERT INTO document_types (key, label, description, required, sort_order) VALUES
  ('acta_constitutiva',       'Acta constitutiva',            'Para personas morales: acta constitutiva de la empresa.',                     false, 1),
  ('identificacion_oficial',  'Identificación oficial',       'INE, pasaporte o cédula profesional del representante legal o titular.',       true,  2),
  ('comprobante_domicilio',   'Comprobante de domicilio',     'Recibo de agua, luz, teléfono o estado de cuenta bancario, máximo 3 meses.',   true,  3),
  ('constancia_situacion_fiscal', 'Constancia de situación fiscal', 'Emitida por el SAT, vigente.',                                           true,  4),
  ('contrato_agencia',        'Contrato de colaboración',     'Contrato de agencia firmado digitalmente a través de la plataforma.',          true,  5)
ON CONFLICT (key) DO NOTHING;

-- 2. Agency documents (one row per upload attempt; is_current marks the active version)
CREATE TABLE IF NOT EXISTS agency_documents (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id         uuid        NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  document_type_key text        NOT NULL REFERENCES document_types(key),
  storage_path      text        NOT NULL,          -- relative path inside the bucket
  file_name         text        NOT NULL,
  mime_type         text,
  file_size_bytes   bigint,
  is_current        boolean     NOT NULL DEFAULT true,
  status            text        NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','approved','rejected','superseded')),
  rejection_reason  text,
  reviewed_by       uuid        REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  uploaded_by       uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agency_documents ENABLE ROW LEVEL SECURITY;

-- Agency can read their own docs
CREATE POLICY "agency_read_own_documents" ON agency_documents
  FOR SELECT TO authenticated
  USING (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()));

-- Agency can insert their own docs
CREATE POLICY "agency_insert_own_documents" ON agency_documents
  FOR INSERT TO authenticated
  WITH CHECK (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()));

-- Agency can update is_current on their own docs (needed for supersede)
CREATE POLICY "agency_update_own_documents" ON agency_documents
  FOR UPDATE TO authenticated
  USING  (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()))
  WITH CHECK (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()));

-- Admins full access
CREATE POLICY "admin_all_agency_documents" ON agency_documents
  FOR ALL TO authenticated
  USING  ((SELECT role FROM users WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_agency_documents_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agency_documents_updated_at ON agency_documents;
CREATE TRIGGER trg_agency_documents_updated_at
  BEFORE UPDATE ON agency_documents
  FOR EACH ROW EXECUTE FUNCTION update_agency_documents_updated_at();

CREATE INDEX IF NOT EXISTS idx_agency_documents_agency_id ON agency_documents(agency_id);
CREATE INDEX IF NOT EXISTS idx_agency_documents_type_current ON agency_documents(agency_id, document_type_key, is_current);

-- 3. Contract acceptances (OTP-based digital signature)
CREATE TABLE IF NOT EXISTS contract_acceptances (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id             uuid        NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  contract_version      text        NOT NULL,
  status                text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','signed')),
  -- OTP fields
  otp_code_hash         text,
  otp_expires_at        timestamptz,
  otp_request_count     int         NOT NULL DEFAULT 0,
  otp_window_started_at timestamptz,
  -- Acceptance metadata
  ip_address            text,
  user_agent            text,
  signed_at             timestamptz,
  signer_user_id        uuid        REFERENCES users(id) ON DELETE SET NULL,
  -- Audit
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contract_acceptances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agency_read_own_contract" ON contract_acceptances
  FOR SELECT TO authenticated
  USING (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()));

CREATE POLICY "agency_insert_own_contract" ON contract_acceptances
  FOR INSERT TO authenticated
  WITH CHECK (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()));

CREATE POLICY "agency_update_own_contract" ON contract_acceptances
  FOR UPDATE TO authenticated
  USING  (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()))
  WITH CHECK (agency_id IN (SELECT id FROM agencies WHERE user_id = auth.uid()));

CREATE POLICY "admin_all_contract_acceptances" ON contract_acceptances
  FOR ALL TO authenticated
  USING  ((SELECT role FROM users WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_contract_acceptances_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contract_acceptances_updated_at ON contract_acceptances;
CREATE TRIGGER trg_contract_acceptances_updated_at
  BEFORE UPDATE ON contract_acceptances
  FOR EACH ROW EXECUTE FUNCTION update_contract_acceptances_updated_at();

CREATE INDEX IF NOT EXISTS idx_contract_acceptances_agency_id ON contract_acceptances(agency_id);

-- 4. Fraud / permanent-ban blocklist
CREATE TABLE IF NOT EXISTS fraud_blocklist (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id       uuid        REFERENCES agencies(id) ON DELETE SET NULL,
  rfc             text,
  email           text,
  ip_address      text,
  reason          text        NOT NULL,
  blocked_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz            -- NULL = permanent
);

ALTER TABLE fraud_blocklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_fraud_blocklist" ON fraud_blocklist
  FOR ALL TO authenticated
  USING  ((SELECT role FROM users WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM users WHERE id = auth.uid()) = 'admin');

CREATE INDEX IF NOT EXISTS idx_fraud_blocklist_rfc      ON fraud_blocklist(rfc)      WHERE rfc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fraud_blocklist_email    ON fraud_blocklist(email)    WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fraud_blocklist_agency   ON fraud_blocklist(agency_id) WHERE agency_id IS NOT NULL;
