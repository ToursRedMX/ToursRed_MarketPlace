-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827220727
--   name:    010_ecosystem_trips.sql
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
-- Migration: 010_ecosystem_trips
-- Purpose: Create ecosystem.trips table for global travel itineraries
-- Schema: ecosystem
-- Backwards-compatible: YES (new table in new schema)
-- ToursRed impact: NONE
-- ============================================================================
--
-- A Trip represents a user's global travel itinerary. It can aggregate items
-- from multiple verticals (ToursRed tours, Nature Stay accommodations,
-- RoutesRed transport). A Trip can exist without any bookings (planning phase).
--
-- Table: ecosystem.trips
--
-- Columns:
--   id                    uuid PK
--   user_id               uuid NOT NULL → public.users(id) ON DELETE RESTRICT
--   title                 text NOT NULL
--   status                text NOT NULL DEFAULT 'planning'
--   start_date            date (nullable during planning)
--   end_date              date (nullable during planning)
--   destination_label     text (summary of main destination)
--   destination_location  geography(Point, 4326) (PostGIS)
--   timezone              text NOT NULL DEFAULT 'America/Mexico_City'
--   cover_image_url       text
--   metadata              jsonb NOT NULL DEFAULT '{}'
--   archived_at           timestamptz (soft delete)
--   created_at            timestamptz NOT NULL DEFAULT now()
--   updated_at            timestamptz NOT NULL DEFAULT now()
--
-- Constraints:
--   trips_status_check: status IN (planning, confirmed, in_progress, completed, cancelled)
--   trips_date_consistency: end_date >= start_date when both non-null
--
-- FK strategy:
--   user_id → public.users(id) ON DELETE RESTRICT
--   RESTRICT prevents accidental user deletion from cascading trip destruction.
--   Users are soft-deleted via is_active=false, not physically removed.
--
-- RLS:
--   SELECT: own trips + super_admin/global
--   INSERT: own trips only
--   UPDATE: own trips only (includes archived_at for soft delete)
--   No DELETE policy for authenticated (soft delete via archived_at)
--
-- Triggers:
--   trg_trips_updated_at: BEFORE UPDATE → ecosystem.update_updated_at()
--   trg_trips_validate_timezone: BEFORE INSERT OR UPDATE OF timezone
--     → ecosystem.validate_trip_timezone()
--
-- Timezone validation:
--   Done via trigger (not CHECK) because pg_timezone_names is catalog data
--   that can change with server updates. CHECK constraints assume immutability
--   relative to the row
;

a trigger is the correct mechanism for catalog lookups.
--
-- Grants:
--   GRANT SELECT, INSERT, UPDATE ON ecosystem.trips TO authenticated
--   No DELETE granted to authenticated.
--   No access for anon.
-- ============================================================================

-- ============================================================================
-- 1. Table
-- ============================================================================
CREATE TABLE ecosystem.trips (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  title                 text        NOT NULL,
  status                text        NOT NULL DEFAULT 'planning',
  start_date            date,
  end_date              date,
  destination_label     text,
  destination_location  geography(Point, 4326),
  timezone              text        NOT NULL DEFAULT 'America/Mexico_City',
  cover_image_url       text,
  metadata              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  archived_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT trips_status_check
    CHECK (status IN ('planning', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT trips_date_consistency
    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
)
;



-- ============================================================================
-- 2. Indexes
-- ============================================================================
CREATE INDEX idx_trips_user_id
  ON ecosystem.trips (user_id)
;



CREATE INDEX idx_trips_user_status
  ON ecosystem.trips (user_id, status)
;



CREATE INDEX idx_trips_user_start_date
  ON ecosystem.trips (user_id, start_date)
;



-- ============================================================================
-- 3. Triggers
-- ============================================================================

-- updated_at trigger
CREATE TRIGGER trg_trips_updated_at
  BEFORE UPDATE ON ecosystem.trips
  FOR EACH ROW
  EXECUTE FUNCTION ecosystem.update_updated_at()
;



-- timezone validation trigger
CREATE TRIGGER trg_trips_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON ecosystem.trips
  FOR EACH ROW
  EXECUTE FUNCTION ecosystem.validate_trip_timezone()
;



-- ============================================================================
-- 4. RLS
-- ============================================================================
ALTER TABLE ecosystem.trips ENABLE ROW LEVEL SECURITY
;



-- SELECT: users see their own trips
;

super_admin/global sees all
CREATE POLICY "trips_select_own"
  ON ecosystem.trips FOR SELECT
  TO authenticated
  USING (user_id = auth.uid())
;



CREATE POLICY "trips_select_admin"
  ON ecosystem.trips FOR SELECT
  TO authenticated
  USING (public.has_role('super_admin', 'global'))
;



-- INSERT: users create their own trips
CREATE POLICY "trips_insert_own"
  ON ecosystem.trips FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid())
;



-- UPDATE: users edit their own trips (includes setting archived_at)
CREATE POLICY "trips_update_own"
  ON ecosystem.trips FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid())
;



-- No DELETE policy for authenticated — soft delete via archived_at

-- ============================================================================
-- 5. Grants
-- ============================================================================
GRANT SELECT, INSERT, UPDATE ON ecosystem.trips TO authenticated
;


GRANT SELECT, INSERT, UPDATE, DELETE ON ecosystem.trips TO service_role
;
