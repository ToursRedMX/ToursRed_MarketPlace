-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827003515
--   name:    routesred_documents
--
-- Recuperado : las sentencias ejecutadas, en su orden original.
-- Perdido    : los comentarios sueltos entre sentencias. El ledger guarda solo
--              sentencias ejecutables, asi que la documentacion que tuviera el
--              archivo original no es recuperable desde aqui.
-- Transformado: saltos de linea desescapados y ';' separadores repuestos, que
--              statements[] no conserva. La alineacion puede diferir.
--
-- Se agrega para que el cambio de esquema sea revisable y reproducible desde
-- el repo. Para el detalle de por que existe, ver el bullet del desfase de
-- migraciones en claude.md.
-- ============================================================================

/*
# RoutesRed — Document Types + Provider Documents

Creates document_types (applies_to: provider/vehicle/driver) with provider_type
filtering (individual/company/both), and provider_documents for storing document
metadata. File storage is handled by Supabase Storage; this table only tracks metadata.
*/

-- document_types
CREATE TABLE IF NOT EXISTS routesred.document_types (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  description    text,
  applies_to     text NOT NULL,
  provider_types text[] NOT NULL DEFAULT ARRAY['individual', 'company'],
  is_required    boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dt_applies_to_check CHECK (applies_to IN ('provider', 'vehicle', 'driver'))
);

ALTER TABLE routesred.document_types ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS dt_updated_at ON routesred.document_types;
CREATE TRIGGER dt_updated_at BEFORE UPDATE ON routesred.document_types
  FOR EACH ROW EXECUTE FUNCTION routesred.set_updated_at();

DROP POLICY IF EXISTS "public_read_document_types" ON routesred.document_types;
CREATE POLICY "public_read_document_types"
  ON routesred.document_types FOR SELECT TO anon, authenticated USING (true);

-- provider_documents
CREATE TABLE IF NOT EXISTS routesred.provider_documents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_provider_id uuid NOT NULL REFERENCES routesred.transport_providers(id) ON DELETE CASCADE,
  vehicle_id            uuid REFERENCES routesred.vehicles(id) ON DELETE CASCADE,
  driver_id             uuid REFERENCES routesred.drivers(id) ON DELETE CASCADE,
  document_type_id      uuid NOT NULL REFERENCES routesred.document_types(id) ON DELETE RESTRICT,
  file_url              text NOT NULL,
  document_number       text,
  issued_at             date,
  expires_at            date,
  status                text NOT NULL DEFAULT 'pending',
  rejection_reason      text,
  reviewed_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pd_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  CONSTRAINT pd_entity_check CHECK (
    (vehicle_id IS NULL AND driver_id IS NULL) OR
    (vehicle_id IS NOT NULL AND driver_id IS NULL) OR
    (vehicle_id IS NULL AND driver_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS pd_provider_idx ON routesred.provider_documents (transport_provider_id);
CREATE INDEX IF NOT EXISTS pd_vehicle_idx ON routesred.provider_documents (vehicle_id);
CREATE INDEX IF NOT EXISTS pd_driver_idx ON routesred.provider_documents (driver_id);
CREATE INDEX IF NOT EXISTS pd_status_idx ON routesred.provider_documents (status);

ALTER TABLE routesred.provider_documents ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS pd_updated_at ON routesred.provider_documents;
CREATE TRIGGER pd_updated_at BEFORE UPDATE ON routesred.provider_documents
  FOR EACH ROW EXECUTE FUNCTION routesred.set_updated_at();

-- RLS: provider_documents — members can CRUD their provider's docs; admins can review
DROP POLICY IF EXISTS "pd_select_members" ON routesred.provider_documents;
CREATE POLICY "pd_select_members"
  ON routesred.provider_documents FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = provider_documents.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active') OR public.is_super_admin());

DROP POLICY IF EXISTS "pd_insert_members" ON routesred.provider_documents;
CREATE POLICY "pd_insert_members"
  ON routesred.provider_documents FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = provider_documents.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active') OR public.is_super_admin());

DROP POLICY IF EXISTS "pd_update_members" ON routesred.provider_documents;
CREATE POLICY "pd_update_members"
  ON routesred.provider_documents FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = provider_documents.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active') OR public.is_super_admin())
  WITH CHECK (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = provider_documents.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active') OR public.is_super_admin());

DROP POLICY IF EXISTS "pd_delete_members" ON routesred.provider_documents;
CREATE POLICY "pd_delete_members"
  ON routesred.provider_documents FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM routesred.transport_provider_users tpu
    WHERE tpu.transport_provider_id = provider_documents.transport_provider_id
    AND tpu.user_id = auth.uid() AND tpu.status = 'active'
    AND tpu.role IN ('owner', 'administrator')) OR public.is_super_admin());

-- Seed document types
INSERT INTO routesred.document_types (code, name, applies_to, provider_types, is_required, sort_order)
VALUES
  -- Provider documents
  ('rfc', 'RFC / Constancia de Situacion Fiscal', 'provider', ARRAY['individual', 'company'], true, 1),
  ('id_representative', 'Identificacion del Representante', 'provider', ARRAY['company'], true, 2),
  ('id_individual', 'Identificacion Personal', 'provider', ARRAY['individual'], true, 3),
  ('transport_permit', 'Permiso de Transporte', 'provider', ARRAY['individual', 'company'], false, 4),
  ('liability_insurance', 'Seguro de Responsabilidad Civil', 'provider', ARRAY['individual', 'company'], true, 5),
  ('incorporation_docs', 'Documento Constitutivo', 'provider', ARRAY['company'], false, 6),
  -- Vehicle documents
  ('circulation_card', 'Tarjeta de Circulacion', 'vehicle', ARRAY['individual', 'company'], true, 10),
  ('vehicle_insurance', 'Poliza de Seguro del Vehiculo', 'vehicle', ARRAY['individual', 'company'], true, 11),
  ('vehicle_permit', 'Permiso del Vehiculo', 'vehicle', ARRAY['individual', 'company'], false, 12),
  ('vehicle_inspection', 'Verificacion', 'vehicle', ARRAY['individual', 'company'], false, 13),
  ('vehicle_other', 'Otro Documento del Vehiculo', 'vehicle', ARRAY['individual', 'company'], false, 14),
  -- Driver documents
  ('driver_license', 'Licencia de Conducir', 'driver', ARRAY['individual', 'company'], true, 20),
  ('driver_id', 'Identificacion del Conductor', 'driver', ARRAY['individual', 'company'], true, 21),
  ('driver_certification', 'Certificacion', 'driver', ARRAY['individual', 'company'], false, 22)
ON CONFLICT (code) DO NOTHING;

;
