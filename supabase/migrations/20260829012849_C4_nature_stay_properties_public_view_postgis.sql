-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260829012849
--   name:    C4_nature_stay_properties_public_view_postgis.sql
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

-- ============================================================================
-- Migration: C4 — nature_stay properties + property_private_details + views
-- ============================================================================

-- 1. Table: nature_stay.properties (marketplace + operational)
CREATE TABLE IF NOT EXISTS nature_stay.properties (
  id                      uuid          NOT NULL DEFAULT gen_random_uuid(),
  host_id                 uuid          NOT NULL,
  property_type_id        uuid          NOT NULL,
  name                    text          NOT NULL,
  slug                    text          NOT NULL,
  short_description       text,
  description             text,
  country_code            text          NOT NULL DEFAULT 'MX',
  state                   text,
  city                    text,
  municipality            text,
  timezone                text          NOT NULL DEFAULT 'America/Mexico_City',
  check_in_time           time,
  check_out_time          time,
  status                  text          NOT NULL DEFAULT 'draft',
  verification_status     text          NOT NULL DEFAULT 'unverified',
  is_published            boolean       NOT NULL DEFAULT false,
  published_at            timestamptz,
  instant_booking_enabled boolean       NOT NULL DEFAULT false,
  pets_allowed            boolean,
  children_allowed        boolean,
  minimum_age             integer,
  smoking_allowed         boolean,
  parties_allowed         boolean,
  accessibility_info      text,
  house_rules             text,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now(),
  archived_at             timestamptz,

  CONSTRAINT properties_pkey PRIMARY KEY (id),
  CONSTRAINT properties_slug_unique UNIQUE (slug),
  CONSTRAINT properties_status_check CHECK (status IN ('draft','pending_review','active','suspended','rejected','inactive')),
  CONSTRAINT properties_verification_check CHECK (verification_status IN ('unverified','pending','verified','rejected')),
  CONSTRAINT properties_publishing_consistency CHECK (
    is_published = false
    OR (is_published = true AND published_at IS NOT NULL)
  ),
  CONSTRAINT properties_name_nonempty CHECK (name <> ''),
  CONSTRAINT properties_slug_nonempty CHECK (slug <> ''),
  CONSTRAINT properties_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT properties_slug_reserved CHECK (
    slug NOT IN ('new','admin','account','settings','login','property','properties',
                 'host','hosts','booking','bookings','search','api','dashboard',
                 'profile','images','amenities','units','tours')
  ),
  CONSTRAINT properties_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT properties_minimum_age_check CHECK (minimum_age IS NULL OR minimum_age >= 0)
)
;



CREATE INDEX IF NOT EXISTS idx_properties_host_id
  ON nature_stay.properties (host_id)
;



CREATE INDEX IF NOT EXISTS idx_properties_status_published_archived
  ON nature_stay.properties (status, is_published, archived_at)
;



CREATE INDEX IF NOT EXISTS idx_properties_property_type_id
  ON nature_stay.properties (property_type_id)
;



-- 2. Table: nature_stay.property_private_details
CREATE TABLE IF NOT EXISTS nature_stay.property_private_details (
  property_id             uuid                        NOT NULL,
  address                 text,
  postal_code             text,
  coordinates             extensions.geography(Point, 4326),
  metadata                jsonb                       NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz                 NOT NULL DEFAULT now(),
  updated_at              timestamptz                 NOT NULL DEFAULT now(),

  CONSTRAINT property_private_details_pkey PRIMARY KEY (property_id)
)
;



CREATE INDEX IF NOT EXISTS idx_property_private_details_coordinates
  ON nature_stay.property_private_details USING GIST (coordinates)
;



-- 3. Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'properties_host_id_fkey'
      AND table_name = 'properties'
      AND table_schema = 'nature_stay'
  ) THEN
    ALTER TABLE nature_stay.properties
      ADD CONSTRAINT properties_host_id_fkey
      FOREIGN KEY (host_id) REFERENCES nature_stay.host_profiles(id) ON DELETE RESTRICT
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'properties_property_type_id_fkey'
      AND table_name = 'properties'
      AND table_schema = 'nature_stay'
  ) THEN
    ALTER TABLE nature_stay.properties
      ADD CONSTRAINT properties_property_type_id_fkey
      FOREIGN KEY (property_type_id) REFERENCES nature_stay.property_types(id) ON DELETE RESTRICT
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'property_private_details_property_id_fkey'
      AND table_name = 'property_private_details'
      AND table_schema = 'nature_stay'
  ) THEN
    ALTER TABLE nature_stay.property_private_details
      ADD CONSTRAINT property_private_details_property_id_fkey
      FOREIGN KEY (property_id) REFERENCES nature_stay.properties(id) ON DELETE CASCADE
;


  END IF
;


END $$
;



-- 4. RLS on properties
ALTER TABLE nature_stay.properties ENABLE ROW LEVEL SECURITY
;



DROP POLICY IF EXISTS "properties_select_owner" ON nature_stay.properties
;


CREATE POLICY "properties_select_owner"
ON nature_stay.properties FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    WHERE ha.host_id = properties.host_id
      AND ha.user_id = auth.uid()
  )
)
;



DROP POLICY IF EXISTS "properties_select_super_admin" ON nature_stay.properties
;


CREATE POLICY "properties_select_super_admin"
ON nature_stay.properties FOR SELECT
TO authenticated
USING (public.has_role('super_admin', 'global'))
;



DROP POLICY IF EXISTS "properties_insert_owner" ON nature_stay.properties
;


CREATE POLICY "properties_insert_owner"
ON nature_stay.properties FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role('host', 'naturestayred')
  AND host_id IN (
    SELECT ha.host_id FROM nature_stay.host_accounts ha
    WHERE ha.user_id = auth.uid()
      AND ha.is_active = true
      AND ha.onboarding_status = 'active'
      AND ha.archived_at IS NULL
  )
)
;



DROP POLICY IF EXISTS "properties_update_owner" ON nature_stay.properties
;


CREATE POLICY "properties_update_owner"
ON nature_stay.properties FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    WHERE ha.host_id = properties.host_id
      AND ha.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    WHERE ha.host_id = properties.host_id
      AND ha.user_id = auth.uid()
  )
)
;



-- 5. RLS on property_private_details
ALTER TABLE nature_stay.property_private_details ENABLE ROW LEVEL SECURITY
;



DROP POLICY IF EXISTS "property_private_details_select_owner" ON nature_stay.property_private_details
;


CREATE POLICY "property_private_details_select_owner"
ON nature_stay.property_private_details FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    JOIN nature_stay.properties p ON p.host_id = ha.host_id
    WHERE ha.user_id = auth.uid()
      AND p.id = property_private_details.property_id
  )
)
;



DROP POLICY IF EXISTS "property_private_details_select_super_admin" ON nature_stay.property_private_details
;


CREATE POLICY "property_private_details_select_super_admin"
ON nature_stay.property_private_details FOR SELECT
TO authenticated
USING (public.has_role('super_admin', 'global'))
;



DROP POLICY IF EXISTS "property_private_details_insert_owner" ON nature_stay.property_private_details
;


CREATE POLICY "property_private_details_insert_owner"
ON nature_stay.property_private_details FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    JOIN nature_stay.properties p ON p.host_id = ha.host_id
    WHERE ha.user_id = auth.uid()
      AND p.id = property_private_details.property_id
  )
)
;



DROP POLICY IF EXISTS "property_private_details_update_owner" ON nature_stay.property_private_details
;


CREATE POLICY "property_private_details_update_owner"
ON nature_stay.property_private_details FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    JOIN nature_stay.properties p ON p.host_id = ha.host_id
    WHERE ha.user_id = auth.uid()
      AND p.id = property_private_details.property_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    JOIN nature_stay.properties p ON p.host_id = ha.host_id
    WHERE ha.user_id = auth.uid()
      AND p.id = property_private_details.property_id
  )
)
;



-- 6. Grants on properties
GRANT SELECT ON nature_stay.properties TO authenticated
;



GRANT INSERT (
  host_id, property_type_id, name, slug, short_description, description,
  country_code, state, city, municipality, timezone, check_in_time,
  check_out_time, instant_booking_enabled, pets_allowed, children_allowed,
  minimum_age, smoking_allowed, parties_allowed, accessibility_info,
  house_rules
) ON nature_stay.properties TO authenticated
;



GRANT UPDATE (
  property_type_id, name, slug, short_description, description,
  country_code, state, city, municipality, timezone, check_in_time,
  check_out_time, is_published, instant_booking_enabled, pets_allowed,
  children_allowed, minimum_age, smoking_allowed, parties_allowed,
  accessibility_info, house_rules
) ON nature_stay.properties TO authenticated
;



GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.properties TO service_role
;



-- 7. Grants on property_private_details
GRANT SELECT, INSERT, UPDATE ON nature_stay.property_private_details TO authenticated
;


GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.property_private_details TO service_role
;



-- 8. View: nature_stay.properties_public (security_barrier)
CREATE OR REPLACE VIEW nature_stay.properties_public
WITH (security_barrier = true) AS
SELECT
  p.id,
  p.host_id,
  p.property_type_id,
  p.name,
  p.slug,
  p.short_description,
  p.description,
  p.country_code,
  p.state,
  p.city,
  p.municipality,
  p.timezone,
  p.check_in_time,
  p.check_out_time,
  p.instant_booking_enabled,
  p.pets_allowed,
  p.children_allowed,
  p.minimum_age,
  p.smoking_allowed,
  p.parties_allowed,
  p.accessibility_info,
  p.house_rules,
  p.created_at,
  p.updated_at
FROM nature_stay.properties p
WHERE p.status = 'active'
  AND p.is_published = true
  AND p.verification_status = 'verified'
  AND p.archived_at IS NULL
  AND EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    WHERE ha.host_id = p.host_id
      AND ha.is_active = true
      AND ha.onboarding_status = 'active'
      AND ha.archived_at IS NULL
  )
;



REVOKE ALL ON nature_stay.properties_public FROM PUBLIC
;


GRANT SELECT ON nature_stay.properties_public TO anon, authenticated
;



-- 9. View: nature_stay.property_owner_view (security_invoker)
CREATE OR REPLACE VIEW nature_stay.property_owner_view
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.host_id,
  p.property_type_id,
  p.name,
  p.slug,
  p.short_description,
  p.description,
  p.country_code,
  p.state,
  p.city,
  p.municipality,
  p.timezone,
  p.check_in_time,
  p.check_out_time,
  p.status,
  p.verification_status,
  p.is_published,
  p.published_at,
  p.instant_booking_enabled,
  p.pets_allowed,
  p.children_allowed,
  p.minimum_age,
  p.smoking_allowed,
  p.parties_allowed,
  p.accessibility_info,
  p.house_rules,
  p.created_at,
  p.updated_at,
  p.archived_at,
  ppd.address,
  ppd.postal_code,
  ppd.coordinates,
  ppd.metadata
FROM nature_stay.properties p
LEFT JOIN nature_stay.property_private_details ppd ON ppd.property_id = p.id
WHERE EXISTS (
  SELECT 1 FROM nature_stay.host_accounts ha
  WHERE ha.user_id = auth.uid()
    AND ha.host_id = p.host_id
)
;



REVOKE ALL ON nature_stay.property_owner_view FROM PUBLIC
;


GRANT SELECT ON nature_stay.property_owner_view TO authenticated
;



-- 10. Function: nature_stay.validate_property_publication()
CREATE OR REPLACE FUNCTION nature_stay.validate_property_publication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = nature_stay, pg_temp
AS $$
BEGIN
  IF NEW.is_published = true THEN
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'Cannot publish property %: status must be active.', NEW.id
;


    END IF
;


    IF NEW.verification_status <> 'verified' THEN
      RAISE EXCEPTION 'Cannot publish property %: verification_status must be verified.', NEW.id
;


    END IF
;


    IF NEW.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot publish property %: property is archived.', NEW.id
;


    END IF
;



    IF NOT EXISTS (
      SELECT 1 FROM nature_stay.host_accounts ha
      WHERE ha.host_id = NEW.host_id
        AND ha.is_active = true
        AND ha.onboarding_status = 'active'
        AND ha.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Cannot publish property %: host is not active or not in active onboarding state.', NEW.id
;


    END IF
;



    IF NEW.published_at IS NULL THEN
      NEW.published_at := now()
;


    END IF
;


  END IF
;



  RETURN NEW
;


END
;


$$
;



REVOKE EXECUTE ON FUNCTION nature_stay.validate_property_publication() FROM PUBLIC
;


GRANT EXECUTE ON FUNCTION nature_stay.validate_property_publication() TO authenticated, service_role
;



-- 11. Triggers on properties
DROP TRIGGER IF EXISTS trg_properties_updated_at ON nature_stay.properties
;


CREATE TRIGGER trg_properties_updated_at
  BEFORE INSERT OR UPDATE ON nature_stay.properties
  FOR EACH ROW
  EXECUTE FUNCTION nature_stay.update_updated_at()
;



DROP TRIGGER IF EXISTS trg_properties_validate_timezone ON nature_stay.properties
;


CREATE TRIGGER trg_properties_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON nature_stay.properties
  FOR EACH ROW
  EXECUTE FUNCTION nature_stay.validate_timezone()
;



DROP TRIGGER IF EXISTS trg_properties_validate_publication ON nature_stay.properties
;


CREATE TRIGGER trg_properties_validate_publication
  BEFORE INSERT OR UPDATE OF is_published ON nature_stay.properties
  FOR EACH ROW
  EXECUTE FUNCTION nature_stay.validate_property_publication()
;



-- 12. Trigger on property_private_details
DROP TRIGGER IF EXISTS trg_property_private_details_updated_at ON nature_stay.property_private_details
;


CREATE TRIGGER trg_property_private_details_updated_at
  BEFORE INSERT OR UPDATE ON nature_stay.property_private_details
  FOR EACH ROW
  EXECUTE FUNCTION nature_stay.update_updated_at()
;
