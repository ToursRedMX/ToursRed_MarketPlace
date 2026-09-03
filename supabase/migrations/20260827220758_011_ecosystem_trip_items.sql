-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827220758
--   name:    011_ecosystem_trip_items.sql
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
-- Migration: 011_ecosystem_trip_items
-- Purpose: Create ecosystem.trip_items table for timeline elements of a trip
-- Schema: ecosystem
-- Backwards-compatible: YES (new table in new schema)
-- ToursRed impact: NONE
-- ============================================================================
--
-- A trip_item represents an element in the timeline of a trip. It can be:
--   - A booking from a vertical (linked via a bridge table)
--   - A manual entry by the user (note, activity, other)
--
-- Table: ecosystem.trip_items
--
-- Columns:
--   id            uuid PK
--   trip_id       uuid NOT NULL → ecosystem.trips(id) ON DELETE CASCADE
--   platform      text NOT NULL (toursred, naturestayred, routesred, ecosystem)
--   item_type     text NOT NULL (accommodation, tour, transport, activity, note, other)
--   display_label text (snapshot for timeline rendering)
--   start_at      timestamptz (nullable)
--   end_at        timestamptz (nullable)
--   sort_order    integer NOT NULL DEFAULT 0
--   source        text NOT NULL DEFAULT 'manual' (direct, cross_sell, bundle, campaign, manual, system)
--   metadata      jsonb NOT NULL DEFAULT '{}'
--   archived_at   timestamptz (soft delete)
--   created_at    timestamptz NOT NULL DEFAULT now()
--   updated_at    timestamptz NOT NULL DEFAULT now()
--
-- FK strategy:
--   trip_id → ecosystem.trips(id) ON DELETE CASCADE
--   Deleting a trip deletes its items. This does NOT cascade to any booking
--   — the bridge table's FK to public.bookings uses RESTRICT.
--
-- RLS:
--   Access derived from trip ownership via EXISTS JOIN to ecosystem.trips.
--   SELECT: own trips + super_admin/global
--   INSERT: own trips only
--   UPDATE: own trips only (includes setting archived_at for soft delete)
--   No DELETE policy for authenticated (soft delete via archived_at)
--
-- Triggers:
--   trg_trip_items_updated_at: BEFORE UPDATE → ecosystem.update_updated_at()
--
-- NOTE: The semantic protection trigger (protect_linked_trip_item) is NOT
-- created in this migration. It depends on ecosystem.trip_toursred_bookings
-- which is created in migration 012. The trigger will be added in 012 after
-- the bridge table exists to avoid a window where the trigger references
-- a non-existent table.
--
-- Grants:
--   GRANT SELECT, INSERT, UPDATE ON ecosystem.trip_items TO authenticated
--   No DELETE granted to authenticated.
--   No access for anon.
-- ============================================================================

-- ============================================================================
-- 1. Table
-- ============================================================================
CREATE TABLE ecosystem.trip_items (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       uuid        NOT NULL REFERENCES ecosystem.trips(id) ON DELETE CASCADE,
  platform      text        NOT NULL,
  item_type     text        NOT NULL,
  display_label text,
  start_at      timestamptz,
  end_at        timestamptz,
  sort_order    integer     NOT NULL DEFAULT 0,
  source        text        NOT NULL DEFAULT 'manual',
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT trip_items_platform_check
    CHECK (platform IN ('toursred', 'naturestayred', 'routesred', 'ecosystem')),
  CONSTRAINT trip_items_item_type_check
    CHECK (item_type IN ('accommodation', 'tour', 'transport', 'activity', 'note', 'other')),
  CONSTRAINT trip_items_source_check
    CHECK (source IN ('direct', 'cross_sell', 'bundle', 'campaign', 'manual', 'system')),
  CONSTRAINT trip_items_time_consistency
    CHECK (start_at IS NULL OR end_at IS NULL OR end_at >= start_at),
  CONSTRAINT trip_items_sort_order_nonneg
    CHECK (sort_order >= 0)
)
;



-- ============================================================================
-- 2. Indexes
-- ============================================================================
CREATE INDEX idx_trip_items_trip_id
  ON ecosystem.trip_items (trip_id)
;



CREATE INDEX idx_trip_items_trip_sort
  ON ecosystem.trip_items (trip_id, sort_order)
;



CREATE INDEX idx_trip_items_platform
  ON ecosystem.trip_items (platform)
;



CREATE INDEX idx_trip_items_trip_start
  ON ecosystem.trip_items (trip_id, start_at)
;



-- ============================================================================
-- 3. Triggers
-- ============================================================================

-- updated_at trigger
CREATE TRIGGER trg_trip_items_updated_at
  BEFORE UPDATE ON ecosystem.trip_items
  FOR EACH ROW
  EXECUTE FUNCTION ecosystem.update_updated_at()
;



-- NOTE: trg_trip_items_protect_linked is created in migration 012,
-- after ecosystem.trip_toursred_bookings exists.

-- ============================================================================
-- 4. RLS
-- ============================================================================
ALTER TABLE ecosystem.trip_items ENABLE ROW LEVEL SECURITY
;



-- SELECT: items of own trips
;

super_admin/global sees all
CREATE POLICY "trip_items_select_own"
  ON ecosystem.trip_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ecosystem.trips t
      WHERE t.id = trip_items.trip_id
        AND t.user_id = auth.uid()
    )
  )
;



CREATE POLICY "trip_items_select_admin"
  ON ecosystem.trip_items FOR SELECT
  TO authenticated
  USING (public.has_role('super_admin', 'global'))
;



-- INSERT: create items in own trips
CREATE POLICY "trip_items_insert_own"
  ON ecosystem.trip_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ecosystem.trips t
      WHERE t.id = trip_id
        AND t.user_id = auth.uid()
    )
  )
;



-- UPDATE: edit items of own trips (includes setting archived_at)
CREATE POLICY "trip_items_update_own"
  ON ecosystem.trip_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ecosystem.trips t
      WHERE t.id = trip_items.trip_id
        AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ecosystem.trips t
      WHERE t.id = trip_id
        AND t.user_id = auth.uid()
    )
  )
;



-- No DELETE policy for authenticated — soft delete via archived_at

-- ============================================================================
-- 5. Grants
-- ============================================================================
GRANT SELECT, INSERT, UPDATE ON ecosystem.trip_items TO authenticated
;


GRANT SELECT, INSERT, UPDATE, DELETE ON ecosystem.trip_items TO service_role
;
