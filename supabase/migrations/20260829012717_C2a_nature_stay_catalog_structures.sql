-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260829012717
--   name:    C2a_nature_stay_catalog_structures.sql
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
-- Migration: C2a — nature_stay catalog structures
-- Purpose: Create property_types, unit_types, amenities catalog tables
-- ============================================================================

-- 1. Table: nature_stay.property_types
CREATE TABLE IF NOT EXISTS nature_stay.property_types (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  code          text          NOT NULL,
  name          text          NOT NULL,
  description   text,
  icon          text,
  active        boolean       NOT NULL DEFAULT true,
  sort_order    integer       NOT NULL DEFAULT 0,
  created_at    timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT property_types_pkey PRIMARY KEY (id),
  CONSTRAINT property_types_code_unique UNIQUE (code),
  CONSTRAINT property_types_code_nonempty CHECK (code <> ''),
  CONSTRAINT property_types_code_format CHECK (code ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
  CONSTRAINT property_types_name_nonempty CHECK (name <> ''),
  CONSTRAINT property_types_sort_order CHECK (sort_order >= 0)
)
;



CREATE INDEX IF NOT EXISTS idx_property_types_active_sort
  ON nature_stay.property_types (active, sort_order)
;



-- 2. Table: nature_stay.unit_types
CREATE TABLE IF NOT EXISTS nature_stay.unit_types (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  code          text          NOT NULL,
  name          text          NOT NULL,
  description   text,
  icon          text,
  active        boolean       NOT NULL DEFAULT true,
  sort_order    integer       NOT NULL DEFAULT 0,
  created_at    timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT unit_types_pkey PRIMARY KEY (id),
  CONSTRAINT unit_types_code_unique UNIQUE (code),
  CONSTRAINT unit_types_code_nonempty CHECK (code <> ''),
  CONSTRAINT unit_types_code_format CHECK (code ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
  CONSTRAINT unit_types_name_nonempty CHECK (name <> ''),
  CONSTRAINT unit_types_sort_order CHECK (sort_order >= 0)
)
;



CREATE INDEX IF NOT EXISTS idx_unit_types_active_sort
  ON nature_stay.unit_types (active, sort_order)
;



-- 3. Table: nature_stay.amenities
CREATE TABLE IF NOT EXISTS nature_stay.amenities (
  id            uuid          NOT NULL DEFAULT gen_random_uuid(),
  code          text          NOT NULL,
  name          text          NOT NULL,
  description   text,
  icon          text,
  category      text          NOT NULL DEFAULT 'general',
  active        boolean       NOT NULL DEFAULT true,
  sort_order    integer       NOT NULL DEFAULT 0,
  created_at    timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT amenities_pkey PRIMARY KEY (id),
  CONSTRAINT amenities_code_unique UNIQUE (code),
  CONSTRAINT amenities_code_nonempty CHECK (code <> ''),
  CONSTRAINT amenities_code_format CHECK (code ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$'),
  CONSTRAINT amenities_name_nonempty CHECK (name <> ''),
  CONSTRAINT amenities_sort_order CHECK (sort_order >= 0),
  CONSTRAINT amenities_category_check CHECK (
    category IN ('general','bedroom','bathroom','kitchen','outdoor',
                 'connectivity','accessibility','safety','family',
                 'pets','nature','services')
  )
)
;



CREATE INDEX IF NOT EXISTS idx_amenities_active_sort
  ON nature_stay.amenities (active, sort_order)
;



CREATE INDEX IF NOT EXISTS idx_amenities_category
  ON nature_stay.amenities (category)
;



-- 4. RLS on catalog tables
ALTER TABLE nature_stay.property_types ENABLE ROW LEVEL SECURITY
;


ALTER TABLE nature_stay.unit_types ENABLE ROW LEVEL SECURITY
;


ALTER TABLE nature_stay.amenities ENABLE ROW LEVEL SECURITY
;



DROP POLICY IF EXISTS "property_types_select_anon" ON nature_stay.property_types
;


CREATE POLICY "property_types_select_anon"
ON nature_stay.property_types FOR SELECT
TO anon USING (active = true)
;



DROP POLICY IF EXISTS "property_types_select_authenticated" ON nature_stay.property_types
;


CREATE POLICY "property_types_select_authenticated"
ON nature_stay.property_types FOR SELECT
TO authenticated USING (active = true)
;



DROP POLICY IF EXISTS "unit_types_select_anon" ON nature_stay.unit_types
;


CREATE POLICY "unit_types_select_anon"
ON nature_stay.unit_types FOR SELECT
TO anon USING (active = true)
;



DROP POLICY IF EXISTS "unit_types_select_authenticated" ON nature_stay.unit_types
;


CREATE POLICY "property_types_select_authenticated"
ON nature_stay.unit_types FOR SELECT
TO authenticated USING (active = true)
;



DROP POLICY IF EXISTS "amenities_select_anon" ON nature_stay.amenities
;


CREATE POLICY "amenities_select_anon"
ON nature_stay.amenities FOR SELECT
TO anon USING (active = true)
;



DROP POLICY IF EXISTS "amenities_select_authenticated" ON nature_stay.amenities
;


CREATE POLICY "amenities_select_authenticated"
ON nature_stay.amenities FOR SELECT
TO authenticated USING (active = true)
;



-- 5. Grants on catalog tables
GRANT SELECT ON nature_stay.property_types TO anon, authenticated
;


GRANT SELECT ON nature_stay.unit_types TO anon, authenticated
;


GRANT SELECT ON nature_stay.amenities TO anon, authenticated
;



GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.property_types TO service_role
;


GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.unit_types TO service_role
;


GRANT SELECT, INSERT, UPDATE, DELETE ON nature_stay.amenities TO service_role
;
