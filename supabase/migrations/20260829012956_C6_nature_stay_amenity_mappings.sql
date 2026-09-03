-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260829012956
--   name:    C6_nature_stay_amenity_mappings.sql
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

-- C6 — nature_stay amenity mappings + public views
CREATE TABLE IF NOT EXISTS nature_stay.property_amenities (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  property_id   uuid          NOT NULL,
  amenity_id    uuid          NOT NULL,
  CONSTRAINT property_amenities_pkey PRIMARY KEY (id),
  CONSTRAINT property_amenities_pair_unique UNIQUE (property_id, amenity_id)
)
;


CREATE INDEX IF NOT EXISTS idx_property_amenities_property_id ON nature_stay.property_amenities (property_id)
;


CREATE INDEX IF NOT EXISTS idx_property_amenities_amenity_id ON nature_stay.property_amenities (amenity_id)
;



CREATE TABLE IF NOT EXISTS nature_stay.unit_amenities (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  unit_id       uuid          NOT NULL,
  amenity_id    uuid          NOT NULL,
  CONSTRAINT unit_amenities_pkey PRIMARY KEY (id),
  CONSTRAINT unit_amenities_pair_unique UNIQUE (unit_id, amenity_id)
)
;


CREATE INDEX IF NOT EXISTS idx_unit_amenities_unit_id ON nature_stay.unit_amenities (unit_id)
;


CREATE INDEX IF NOT EXISTS idx_unit_amenities_amenity_id ON nature_stay.unit_amenities (amenity_id)
;



DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'property_amenities_property_id_fkey' AND table_name = 'property_amenities' AND table_schema = 'nature_stay') THEN
    ALTER TABLE nature_stay.property_amenities ADD CONSTRAINT property_amenities_property_id_fkey FOREIGN KEY (property_id) REFERENCES nature_stay.properties(id) ON DELETE CASCADE
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'property_amenities_amenity_id_fkey' AND table_name = 'property_amenities' AND table_schema = 'nature_stay') THEN
    ALTER TABLE nature_stay.property_amenities ADD CONSTRAINT property_amenities_amenity_id_fkey FOREIGN KEY (amenity_id) REFERENCES nature_stay.amenities(id) ON DELETE RESTRICT
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'unit_amenities_unit_id_fkey' AND table_name = 'unit_amenities' AND table_schema = 'nature_stay') THEN
    ALTER TABLE nature_stay.unit_amenities ADD CONSTRAINT unit_amenities_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES nature_stay.units(id) ON DELETE CASCADE
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'unit_amenities_amenity_id_fkey' AND table_name = 'unit_amenities' AND table_schema = 'nature_stay') THEN
    ALTER TABLE nature_stay.unit_amenities ADD CONSTRAINT unit_amenities_amenity_id_fkey FOREIGN KEY (amenity_id) REFERENCES nature_stay.amenities(id) ON DELETE RESTRICT
;


  END IF
;


END $$
;



ALTER TABLE nature_stay.property_amenities ENABLE ROW LEVEL SECURITY
;


DROP POLICY IF EXISTS "property_amenities_select_owner" ON nature_stay.property_amenities
;


CREATE POLICY "property_amenities_select_owner" ON nature_stay.property_amenities FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id WHERE ha.user_id = auth.uid() AND p.id = property_amenities.property_id))
;


DROP POLICY IF EXISTS "property_amenities_select_super_admin" ON nature_stay.property_amenities
;


CREATE POLICY "property_amenities_select_super_admin" ON nature_stay.property_amenities FOR SELECT TO authenticated USING (public.has_role('super_admin', 'global'))
;


DROP POLICY IF EXISTS "property_amenities_insert_owner" ON nature_stay.property_amenities
;


CREATE POLICY "property_amenities_insert_owner" ON nature_stay.property_amenities FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id WHERE ha.user_id = auth.uid() AND p.id = property_amenities.property_id))
;


DROP POLICY IF EXISTS "property_amenities_delete_owner" ON nature_stay.property_amenities
;


CREATE POLICY "property_amenities_delete_owner" ON nature_stay.property_amenities FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id WHERE ha.user_id = auth.uid() AND p.id = property_amenities.property_id))
;



ALTER TABLE nature_stay.unit_amenities ENABLE ROW LEVEL SECURITY
;


DROP POLICY IF EXISTS "unit_amenities_select_owner" ON nature_stay.unit_amenities
;


CREATE POLICY "unit_amenities_select_owner" ON nature_stay.unit_amenities FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id JOIN nature_stay.units u ON u.property_id = p.id WHERE ha.user_id = auth.uid() AND u.id = unit_amenities.unit_id))
;


DROP POLICY IF EXISTS "unit_amenities_select_super_admin" ON nature_stay.unit_amenities
;


CREATE POLICY "unit_amenities_select_super_admin" ON nature_stay.unit_amenities FOR SELECT TO authenticated USING (public.has_role('super_admin', 'global'))
;


DROP POLICY IF EXISTS "unit_amenities_insert_owner" ON nature_stay.unit_amenities
;


CREATE POLICY "unit_amenities_insert_owner" ON nature_stay.unit_amenities FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id JOIN nature_stay.units u ON u.property_id = p.id WHERE ha.user_id = auth.uid() AND u.id = unit_amenities.unit_id))
;


DROP POLICY IF EXISTS "unit_amenities_delete_owner" ON nature_stay.unit_amenities
;


CREATE POLICY "unit_amenities_delete_owner" ON nature_stay.unit_amenities FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id JOIN nature_stay.units u ON u.property_id = p.id WHERE ha.user_id = auth.uid() AND u.id = unit_amenities.unit_id))
;



GRANT SELECT, INSERT, DELETE ON nature_stay.property_amenities TO authenticated
;


GRANT SELECT, INSERT, DELETE ON nature_stay.unit_amenities TO authenticated
;


GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.property_amenities TO service_role
;


GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.unit_amenities TO service_role
;



CREATE OR REPLACE VIEW nature_stay.property_amenities_public WITH (security_barrier = true) AS SELECT pa.id, pa.property_id, pa.amenity_id FROM nature_stay.property_amenities pa WHERE EXISTS (SELECT 1 FROM nature_stay.properties p JOIN nature_stay.host_accounts ha ON ha.host_id = p.host_id WHERE p.id = pa.property_id AND p.status = 'active' AND p.is_published = true AND p.verification_status = 'verified' AND p.archived_at IS NULL AND ha.is_active = true AND ha.onboarding_status = 'active' AND ha.archived_at IS NULL)
;


REVOKE ALL ON nature_stay.property_amenities_public FROM PUBLIC
;


GRANT SELECT ON nature_stay.property_amenities_public TO anon, authenticated
;



CREATE OR REPLACE VIEW nature_stay.unit_amenities_public WITH (security_barrier = true) AS SELECT ua.id, ua.unit_id, ua.amenity_id FROM nature_stay.unit_amenities ua WHERE EXISTS (SELECT 1 FROM nature_stay.units u JOIN nature_stay.properties p ON p.id = u.property_id JOIN nature_stay.host_accounts ha ON ha.host_id = p.host_id WHERE u.id = ua.unit_id AND u.status = 'active' AND u.is_published = true AND u.archived_at IS NULL AND p.status = 'active' AND p.is_published = true AND p.verification_status = 'verified' AND p.archived_at IS NULL AND ha.is_active = true AND ha.onboarding_status = 'active' AND ha.archived_at IS NULL)
;


REVOKE ALL ON nature_stay.unit_amenities_public FROM PUBLIC
;


GRANT SELECT ON nature_stay.unit_amenities_public TO anon, authenticated
;
