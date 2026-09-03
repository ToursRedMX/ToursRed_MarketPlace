-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260829012929
--   name:    C5_nature_stay_units_public_view.sql
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
-- Migration: C5 — nature_stay units + unit_private_details + views
-- ============================================================================

-- 1. Table: nature_stay.units (marketplace + operational)
CREATE TABLE IF NOT EXISTS nature_stay.units (
  id                      uuid            NOT NULL DEFAULT gen_random_uuid(),
  property_id             uuid            NOT NULL,
  unit_type_id            uuid            NOT NULL,
  name                    text            NOT NULL,
  slug                    text,
  description             text,
  quantity                integer         NOT NULL DEFAULT 1,
  max_guests              integer         NOT NULL,
  base_guests             integer         NOT NULL DEFAULT 1,
  max_adults              integer,
  max_children            integer,
  max_infants             integer,
  bedrooms                integer,
  beds                    integer,
  bathrooms               integer,
  area_m2                 numeric(8,2),
  pricing_mode            text            NOT NULL DEFAULT 'per_unit_per_night',
  base_price              numeric(10,2)   NOT NULL,
  extra_guest_price       numeric(10,2),
  currency                text            NOT NULL DEFAULT 'MXN',
  minimum_nights          integer         NOT NULL DEFAULT 1,
  maximum_nights          integer,
  pets_allowed            boolean,
  pet_fee                 numeric(10,2),
  max_pets                integer,
  check_in_time_override  time,
  check_out_time_override time,
  status                  text            NOT NULL DEFAULT 'draft',
  is_published            boolean         NOT NULL DEFAULT false,
  created_at              timestamptz     NOT NULL DEFAULT now(),
  updated_at              timestamptz     NOT NULL DEFAULT now(),
  archived_at             timestamptz,

  CONSTRAINT units_pkey PRIMARY KEY (id),
  CONSTRAINT units_property_slug_unique UNIQUE (property_id, slug),
  CONSTRAINT units_pricing_mode_check CHECK (pricing_mode IN ('per_unit_per_night','per_person_per_night')),
  CONSTRAINT units_status_check CHECK (status IN ('draft','active','suspended','inactive')),
  CONSTRAINT units_quantity_check CHECK (quantity >= 1),
  CONSTRAINT units_base_price_check CHECK (base_price >= 0),
  CONSTRAINT units_extra_guest_price_check CHECK (extra_guest_price IS NULL OR extra_guest_price >= 0),
  CONSTRAINT units_pet_fee_check CHECK (pet_fee IS NULL OR pet_fee >= 0),
  CONSTRAINT units_max_guests_check CHECK (max_guests >= 1),
  CONSTRAINT units_base_guests_check CHECK (base_guests >= 1),
  CONSTRAINT units_base_le_max_guests CHECK (base_guests <= max_guests),
  CONSTRAINT units_max_adults_check CHECK (max_adults IS NULL OR max_adults >= 0),
  CONSTRAINT units_max_children_check CHECK (max_children IS NULL OR max_children >= 0),
  CONSTRAINT units_max_infants_check CHECK (max_infants IS NULL OR max_infants >= 0),
  CONSTRAINT units_bedrooms_check CHECK (bedrooms IS NULL OR bedrooms >= 0),
  CONSTRAINT units_beds_check CHECK (beds IS NULL OR beds >= 0),
  CONSTRAINT units_bathrooms_check CHECK (bathrooms IS NULL OR bathrooms >= 0),
  CONSTRAINT units_area_m2_check CHECK (area_m2 IS NULL OR area_m2 > 0),
  CONSTRAINT units_max_pets_check CHECK (max_pets IS NULL OR max_pets >= 0),
  CONSTRAINT units_minimum_nights_check CHECK (minimum_nights >= 1),
  CONSTRAINT units_maximum_nights_check CHECK (maximum_nights IS NULL OR maximum_nights >= minimum_nights),
  CONSTRAINT units_pricing_consistency CHECK (
    pricing_mode <> 'per_person_per_night' OR extra_guest_price IS NULL
  ),
  CONSTRAINT units_name_nonempty CHECK (name <> ''),
  CONSTRAINT units_currency_format CHECK (currency ~ '^[A-Z]{3}$')
)
;



CREATE INDEX IF NOT EXISTS idx_units_property_id
  ON nature_stay.units (property_id)
;



CREATE INDEX IF NOT EXISTS idx_units_property_status_published_archived
  ON nature_stay.units (property_id, status, is_published, archived_at)
;



CREATE INDEX IF NOT EXISTS idx_units_unit_type_id
  ON nature_stay.units (unit_type_id)
;



-- 2. Table: nature_stay.unit_private_details
CREATE TABLE IF NOT EXISTS nature_stay.unit_private_details (
  unit_id                 uuid          NOT NULL,
  metadata                jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT unit_private_details_pkey PRIMARY KEY (unit_id)
)
;



-- 3. Foreign keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'units_property_id_fkey'
      AND table_name = 'units'
      AND table_schema = 'nature_stay'
  ) THEN
    ALTER TABLE nature_stay.units
      ADD CONSTRAINT units_property_id_fkey
      FOREIGN KEY (property_id) REFERENCES nature_stay.properties(id) ON DELETE RESTRICT
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'units_unit_type_id_fkey'
      AND table_name = 'units'
      AND table_schema = 'nature_stay'
  ) THEN
    ALTER TABLE nature_stay.units
      ADD CONSTRAINT units_unit_type_id_fkey
      FOREIGN KEY (unit_type_id) REFERENCES nature_stay.unit_types(id) ON DELETE RESTRICT
;


  END IF
;



  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'unit_private_details_unit_id_fkey'
      AND table_name = 'unit_private_details'
      AND table_schema = 'nature_stay'
  ) THEN
    ALTER TABLE nature_stay.unit_private_details
      ADD CONSTRAINT unit_private_details_unit_id_fkey
      FOREIGN KEY (unit_id) REFERENCES nature_stay.units(id) ON DELETE CASCADE
;


  END IF
;


END $$
;



-- 4. RLS on units
ALTER TABLE nature_stay.units ENABLE ROW LEVEL SECURITY
;



DROP POLICY IF EXISTS "units_select_owner" ON nature_stay.units
;


CREATE POLICY "units_select_owner"
ON nature_stay.units FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    JOIN nature_stay.properties p ON p.host_id = ha.host_id
    WHERE ha.user_id = auth.uid()
      AND p.id = units.property_id
  )
)
;



DROP POLICY IF EXISTS "units_select_super_admin" ON nature_stay.units
;


CREATE POLICY "units_select_super_admin"
ON nature_stay.units FOR SELECT
TO authenticated
USING (public.has_role('super_admin', 'global'))
;



DROP POLICY IF EXISTS "units_insert_owner" ON nature_stay.units
;


CREATE POLICY "units_insert_owner"
ON nature_stay.units FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role('host', 'naturestayred')
  AND property_id IN (
    SELECT p.id FROM nature_stay.properties p
    JOIN nature_stay.host_accounts ha ON ha.host_id = p.host_id
    WHERE ha.user_id = auth.uid()
      AND ha.is_active = true
      AND ha.onboarding_status = 'active'
      AND ha.archived_at IS NULL
  )
)
;



DROP POLICY IF EXISTS "units_update_owner" ON nature_stay.units
;


CREATE POLICY "units_update_owner"
ON nature_stay.units FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    JOIN nature_stay.properties p ON p.host_id = ha.host_id
    WHERE ha.user_id = auth.uid()
      AND p.id = units.property_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    JOIN nature_stay.properties p ON p.host_id = ha.host_id
    WHERE ha.user_id = auth.uid()
      AND p.id = units.property_id
  )
)
;



-- 5. RLS on unit_private_details
ALTER TABLE nature_stay.unit_private_details ENABLE ROW LEVEL SECURITY
;



DROP POLICY IF EXISTS "unit_private_details_select_owner" ON nature_stay.unit_private_details
;


CREATE POLICY "unit_private_details_select_owner"
ON nature_stay.unit_private_details FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    JOIN nature_stay.properties p ON p.host_id = ha.host_id
    JOIN nature_stay.units u ON u.property_id = p.id
    WHERE ha.user_id = auth.uid()
      AND u.id = unit_private_details.unit_id
  )
)
;



DROP POLICY IF EXISTS "unit_private_details_select_super_admin" ON nature_stay.unit_private_details
;


CREATE POLICY "unit_private_details_select_super_admin"
ON nature_stay.unit_private_details FOR SELECT
TO authenticated
USING (public.has_role('super_admin', 'global'))
;



DROP POLICY IF EXISTS "unit_private_details_insert_owner" ON nature_stay.unit_private_details
;


CREATE POLICY "unit_private_details_insert_owner"
ON nature_stay.unit_private_details FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    JOIN nature_stay.properties p ON p.host_id = ha.host_id
    JOIN nature_stay.units u ON u.property_id = p.id
    WHERE ha.user_id = auth.uid()
      AND u.id = unit_private_details.unit_id
  )
)
;



DROP POLICY IF EXISTS "unit_private_details_update_owner" ON nature_stay.unit_private_details
;


CREATE POLICY "unit_private_details_update_owner"
ON nature_stay.unit_private_details FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    JOIN nature_stay.properties p ON p.host_id = ha.host_id
    JOIN nature_stay.units u ON u.property_id = p.id
    WHERE ha.user_id = auth.uid()
      AND u.id = unit_private_details.unit_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM nature_stay.host_accounts ha
    JOIN nature_stay.properties p ON p.host_id = ha.host_id
    JOIN nature_stay.units u ON u.property_id = p.id
    WHERE ha.user_id = auth.uid()
      AND u.id = unit_private_details.unit_id
  )
)
;



-- 6. Grants on units
GRANT SELECT ON nature_stay.units TO authenticated
;



GRANT INSERT (
  property_id, unit_type_id, name, slug, description, quantity,
  max_guests, base_guests, max_adults, max_children, max_infants,
  bedrooms, beds, bathrooms, area_m2, pricing_mode, base_price,
  extra_guest_price, currency, minimum_nights, maximum_nights,
  pets_allowed, pet_fee, max_pets, check_in_time_override,
  check_out_time_override
) ON nature_stay.units TO authenticated
;



GRANT UPDATE (
  unit_type_id, name, slug, description, quantity, max_guests,
  base_guests, max_adults, max_children, max_infants, bedrooms, beds,
  bathrooms, area_m2, pricing_mode, base_price, extra_guest_price,
  currency, minimum_nights, maximum_nights, pets_allowed, pet_fee,
  max_pets, check_in_time_override, check_out_time_override, is_published
) ON nature_stay.units TO authenticated
;



GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.units TO service_role
;



-- 7. Grants on unit_private_details
GRANT SELECT, INSERT, UPDATE ON nature_stay.unit_private_details TO authenticated
;


GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.unit_private_details TO service_role
;



-- 8. View: nature_stay.units_public (security_barrier)
CREATE OR REPLACE VIEW nature_stay.units_public
WITH (security_barrier = true) AS
SELECT
  u.id,
  u.property_id,
  u.unit_type_id,
  u.name,
  u.slug,
  u.description,
  u.quantity,
  u.max_guests,
  u.base_guests,
  u.max_adults,
  u.max_children,
  u.max_infants,
  u.bedrooms,
  u.beds,
  u.bathrooms,
  u.area_m2,
  u.pricing_mode,
  u.base_price,
  u.extra_guest_price,
  u.currency,
  u.minimum_nights,
  u.maximum_nights,
  u.pets_allowed,
  u.pet_fee,
  u.max_pets,
  u.check_in_time_override,
  u.check_out_time_override,
  u.created_at,
  u.updated_at
FROM nature_stay.units u
WHERE u.status = 'active'
  AND u.is_published = true
  AND u.archived_at IS NULL
  AND EXISTS (
    SELECT 1 FROM nature_stay.properties p
    JOIN nature_stay.host_accounts ha ON ha.host_id = p.host_id
    WHERE p.id = u.property_id
      AND p.status = 'active'
      AND p.is_published = true
      AND p.verification_status = 'verified'
      AND p.archived_at IS NULL
      AND ha.is_active = true
      AND ha.onboarding_status = 'active'
      AND ha.archived_at IS NULL
  )
;



REVOKE ALL ON nature_stay.units_public FROM PUBLIC
;


GRANT SELECT ON nature_stay.units_public TO anon, authenticated
;



-- 9. View: nature_stay.unit_owner_view (security_invoker)
CREATE OR REPLACE VIEW nature_stay.unit_owner_view
WITH (security_invoker = true) AS
SELECT
  u.id,
  u.property_id,
  u.unit_type_id,
  u.name,
  u.slug,
  u.description,
  u.quantity,
  u.max_guests,
  u.base_guests,
  u.max_adults,
  u.max_children,
  u.max_infants,
  u.bedrooms,
  u.beds,
  u.bathrooms,
  u.area_m2,
  u.pricing_mode,
  u.base_price,
  u.extra_guest_price,
  u.currency,
  u.minimum_nights,
  u.maximum_nights,
  u.pets_allowed,
  u.pet_fee,
  u.max_pets,
  u.check_in_time_override,
  u.check_out_time_override,
  u.status,
  u.is_published,
  u.created_at,
  u.updated_at,
  u.archived_at,
  upd.metadata AS private_metadata
FROM nature_stay.units u
LEFT JOIN nature_stay.unit_private_details upd ON upd.unit_id = u.id
WHERE EXISTS (
  SELECT 1 FROM nature_stay.host_accounts ha
  JOIN nature_stay.properties p ON p.host_id = ha.host_id
  WHERE ha.user_id = auth.uid()
    AND p.id = u.property_id
)
;



REVOKE ALL ON nature_stay.unit_owner_view FROM PUBLIC
;


GRANT SELECT ON nature_stay.unit_owner_view TO authenticated
;



-- 10. Function: nature_stay.validate_unit_publication()
CREATE OR REPLACE FUNCTION nature_stay.validate_unit_publication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = nature_stay, pg_temp
AS $$
BEGIN
  IF NEW.is_published = true THEN
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'Cannot publish unit %: status must be active.', NEW.id
;


    END IF
;


    IF NEW.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot publish unit %: unit is archived.', NEW.id
;


    END IF
;



    IF NOT EXISTS (
      SELECT 1 FROM nature_stay.properties p
      WHERE p.id = NEW.property_id
        AND p.status = 'active'
        AND p.is_published = true
        AND p.verification_status = 'verified'
        AND p.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Cannot publish unit %: parent property is not active, published, and verified.', NEW.id
;


    END IF
;



    IF NOT EXISTS (
      SELECT 1 FROM nature_stay.properties p
      JOIN nature_stay.host_accounts ha ON ha.host_id = p.host_id
      WHERE p.id = NEW.property_id
        AND ha.is_active = true
        AND ha.onboarding_status = 'active'
        AND ha.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Cannot publish unit %: parent host is not active.', NEW.id
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



REVOKE EXECUTE ON FUNCTION nature_stay.validate_unit_publication() FROM PUBLIC
;


GRANT EXECUTE ON FUNCTION nature_stay.validate_unit_publication() TO authenticated, service_role
;



-- 11. Triggers on units
DROP TRIGGER IF EXISTS trg_units_updated_at ON nature_stay.units
;


CREATE TRIGGER trg_units_updated_at
  BEFORE INSERT OR UPDATE ON nature_stay.units
  FOR EACH ROW
  EXECUTE FUNCTION nature_stay.update_updated_at()
;



DROP TRIGGER IF EXISTS trg_units_validate_publication ON nature_stay.units
;


CREATE TRIGGER trg_units_validate_publication
  BEFORE INSERT OR UPDATE OF is_published ON nature_stay.units
  FOR EACH ROW
  EXECUTE FUNCTION nature_stay.validate_unit_publication()
;



-- 12. Trigger on unit_private_details
DROP TRIGGER IF EXISTS trg_unit_private_details_updated_at ON nature_stay.unit_private_details
;


CREATE TRIGGER trg_unit_private_details_updated_at
  BEFORE INSERT OR UPDATE ON nature_stay.unit_private_details
  FOR EACH ROW
  EXECUTE FUNCTION nature_stay.update_updated_at()
;
