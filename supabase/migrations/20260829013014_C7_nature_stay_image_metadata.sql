-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260829013014
--   name:    C7_nature_stay_image_metadata.sql
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

-- C7 — nature_stay image metadata + public views
CREATE TABLE IF NOT EXISTS nature_stay.property_images (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  property_id   uuid          NOT NULL,
  storage_path  text          NOT NULL,
  alt_text      text,
  caption       text,
  sort_order    integer       NOT NULL DEFAULT 0,
  is_cover      boolean       NOT NULL DEFAULT false,
  width         integer,
  height        integer,
  file_size     bigint,
  mime_type     text,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT property_images_pkey PRIMARY KEY (id),
  CONSTRAINT property_images_storage_path_unique UNIQUE (storage_path),
  CONSTRAINT property_images_sort_order_check CHECK (sort_order >= 0),
  CONSTRAINT property_images_width_check CHECK (width IS NULL OR width > 0),
  CONSTRAINT property_images_height_check CHECK (height IS NULL OR height > 0),
  CONSTRAINT property_images_file_size_check CHECK (file_size IS NULL OR file_size > 0)
)
;


CREATE UNIQUE INDEX IF NOT EXISTS idx_property_images_cover ON nature_stay.property_images (property_id) WHERE is_cover = true
;


CREATE INDEX IF NOT EXISTS idx_property_images_property_sort ON nature_stay.property_images (property_id, sort_order)
;



CREATE TABLE IF NOT EXISTS nature_stay.unit_images (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  unit_id       uuid          NOT NULL,
  storage_path  text          NOT NULL,
  alt_text      text,
  caption       text,
  sort_order    integer       NOT NULL DEFAULT 0,
  is_cover      boolean       NOT NULL DEFAULT false,
  width         integer,
  height        integer,
  file_size     bigint,
  mime_type     text,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT unit_images_pkey PRIMARY KEY (id),
  CONSTRAINT unit_images_storage_path_unique UNIQUE (storage_path),
  CONSTRAINT unit_images_sort_order_check CHECK (sort_order >= 0),
  CONSTRAINT unit_images_width_check CHECK (width IS NULL OR width > 0),
  CONSTRAINT unit_images_height_check CHECK (height IS NULL OR height > 0),
  CONSTRAINT unit_images_file_size_check CHECK (file_size IS NULL OR file_size > 0)
)
;


CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_images_cover ON nature_stay.unit_images (unit_id) WHERE is_cover = true
;


CREATE INDEX IF NOT EXISTS idx_unit_images_unit_sort ON nature_stay.unit_images (unit_id, sort_order)
;



DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'property_images_property_id_fkey' AND table_name = 'property_images' AND table_schema = 'nature_stay') THEN
    ALTER TABLE nature_stay.property_images ADD CONSTRAINT property_images_property_id_fkey FOREIGN KEY (property_id) REFERENCES nature_stay.properties(id) ON DELETE CASCADE
;


  END IF
;


  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'unit_images_unit_id_fkey' AND table_name = 'unit_images' AND table_schema = 'nature_stay') THEN
    ALTER TABLE nature_stay.unit_images ADD CONSTRAINT unit_images_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES nature_stay.units(id) ON DELETE CASCADE
;


  END IF
;


END $$
;



ALTER TABLE nature_stay.property_images ENABLE ROW LEVEL SECURITY
;


DROP POLICY IF EXISTS "property_images_select_owner" ON nature_stay.property_images
;


CREATE POLICY "property_images_select_owner" ON nature_stay.property_images FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id WHERE ha.user_id = auth.uid() AND p.id = property_images.property_id))
;


DROP POLICY IF EXISTS "property_images_select_super_admin" ON nature_stay.property_images
;


CREATE POLICY "property_images_select_super_admin" ON nature_stay.property_images FOR SELECT TO authenticated USING (public.has_role('super_admin', 'global'))
;


DROP POLICY IF EXISTS "property_images_insert_owner" ON nature_stay.property_images
;


CREATE POLICY "property_images_insert_owner" ON nature_stay.property_images FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id WHERE ha.user_id = auth.uid() AND p.id = property_images.property_id))
;


DROP POLICY IF EXISTS "property_images_update_owner" ON nature_stay.property_images
;


CREATE POLICY "property_images_update_owner" ON nature_stay.property_images FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id WHERE ha.user_id = auth.uid() AND p.id = property_images.property_id)) WITH CHECK (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id WHERE ha.user_id = auth.uid() AND p.id = property_images.property_id))
;


DROP POLICY IF EXISTS "property_images_delete_owner" ON nature_stay.property_images
;


CREATE POLICY "property_images_delete_owner" ON nature_stay.property_images FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id WHERE ha.user_id = auth.uid() AND p.id = property_images.property_id))
;



ALTER TABLE nature_stay.unit_images ENABLE ROW LEVEL SECURITY
;


DROP POLICY IF EXISTS "unit_images_select_owner" ON nature_stay.unit_images
;


CREATE POLICY "unit_images_select_owner" ON nature_stay.unit_images FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id JOIN nature_stay.units u ON u.property_id = p.id WHERE ha.user_id = auth.uid() AND u.id = unit_images.unit_id))
;


DROP POLICY IF EXISTS "unit_images_select_super_admin" ON nature_stay.unit_images
;


CREATE POLICY "unit_images_select_super_admin" ON nature_stay.unit_images FOR SELECT TO authenticated USING (public.has_role('super_admin', 'global'))
;


DROP POLICY IF EXISTS "unit_images_insert_owner" ON nature_stay.unit_images
;


CREATE POLICY "unit_images_insert_owner" ON nature_stay.unit_images FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id JOIN nature_stay.units u ON u.property_id = p.id WHERE ha.user_id = auth.uid() AND u.id = unit_images.unit_id))
;


DROP POLICY IF EXISTS "unit_images_update_owner" ON nature_stay.unit_images
;


CREATE POLICY "unit_images_update_owner" ON nature_stay.unit_images FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id JOIN nature_stay.units u ON u.property_id = p.id WHERE ha.user_id = auth.uid() AND u.id = unit_images.unit_id)) WITH CHECK (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id JOIN nature_stay.units u ON u.property_id = p.id WHERE ha.user_id = auth.uid() AND u.id = unit_images.unit_id))
;


DROP POLICY IF EXISTS "unit_images_delete_owner" ON nature_stay.unit_images
;


CREATE POLICY "unit_images_delete_owner" ON nature_stay.unit_images FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM nature_stay.host_accounts ha JOIN nature_stay.properties p ON p.host_id = ha.host_id JOIN nature_stay.units u ON u.property_id = p.id WHERE ha.user_id = auth.uid() AND u.id = unit_images.unit_id))
;



GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.property_images TO authenticated
;


GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.unit_images TO authenticated
;


GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.property_images TO service_role
;


GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.unit_images TO service_role
;



CREATE OR REPLACE VIEW nature_stay.property_images_public WITH (security_barrier = true) AS SELECT pi.id, pi.property_id, pi.storage_path, pi.alt_text, pi.caption, pi.sort_order, pi.is_cover, pi.width, pi.height, pi.file_size, pi.mime_type, pi.created_at FROM nature_stay.property_images pi WHERE EXISTS (SELECT 1 FROM nature_stay.properties p JOIN nature_stay.host_accounts ha ON ha.host_id = p.host_id WHERE p.id = pi.property_id AND p.status = 'active' AND p.is_published = true AND p.verification_status = 'verified' AND p.archived_at IS NULL AND ha.is_active = true AND ha.onboarding_status = 'active' AND ha.archived_at IS NULL)
;


REVOKE ALL ON nature_stay.property_images_public FROM PUBLIC
;


GRANT SELECT ON nature_stay.property_images_public TO anon, authenticated
;



CREATE OR REPLACE VIEW nature_stay.unit_images_public WITH (security_barrier = true) AS SELECT ui.id, ui.unit_id, ui.storage_path, ui.alt_text, ui.caption, ui.sort_order, ui.is_cover, ui.width, ui.height, ui.file_size, ui.mime_type, ui.created_at FROM nature_stay.unit_images ui WHERE EXISTS (SELECT 1 FROM nature_stay.units u JOIN nature_stay.properties p ON p.id = u.property_id JOIN nature_stay.host_accounts ha ON ha.host_id = p.host_id WHERE u.id = ui.unit_id AND u.status = 'active' AND u.is_published = true AND u.archived_at IS NULL AND p.status = 'active' AND p.is_published = true AND p.verification_status = 'verified' AND p.archived_at IS NULL AND ha.is_active = true AND ha.onboarding_status = 'active' AND ha.archived_at IS NULL)
;


REVOKE ALL ON nature_stay.unit_images_public FROM PUBLIC
;


GRANT SELECT ON nature_stay.unit_images_public TO anon, authenticated
;
