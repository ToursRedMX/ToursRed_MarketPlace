-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827220829
--   name:    012_ecosystem_trip_toursred_bookings.sql
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
-- Migration: 012_ecosystem_trip_toursred_bookings
-- Purpose: Create bridge table linking trip_items to ToursRed bookings,
--          plus semantic integrity trigger on trip_items
-- Schema: ecosystem
-- Backwards-compatible: YES (new table + new trigger in new schema)
-- ToursRed impact: NONE (read-only FK reference to public.bookings)
-- ============================================================================
--
-- Table: ecosystem.trip_toursred_bookings
--
-- Bridge table establishing a 1:1 relationship between a trip_item and a
-- ToursRed booking. Both trip_item_id and booking_id are UNIQUE, meaning:
--   - A trip_item can have at most one ToursRed booking linked
--   - A ToursRed booking can be linked to at most one trip_item
--
-- Columns:
--   id           uuid PK
--   trip_item_id uuid NOT NULL → ecosystem.trip_items(id) ON DELETE CASCADE
--   booking_id   uuid NOT NULL → public.bookings(id) ON DELETE RESTRICT
--   created_at   timestamptz NOT NULL DEFAULT now()
--
-- FK strategy:
--   trip_item_id → ecosystem.trip_items(id) ON DELETE CASCADE
--     Deleting a trip_item deletes the link. Does NOT delete the booking.
--   booking_id → public.bookings(id) ON DELETE RESTRICT
--     A ToursRed booking cannot be deleted while linked to a trip_item.
--     This protects operational data from ecosystem-side actions.
--
-- RLS:
--   SELECT: own trips (via JOIN) + super_admin/global
--   INSERT: validates THREE conditions:
--     1. trip belongs to the user
--     2. booking belongs to the same user
--     3. trip_item has platform='toursred' AND item_type='tour'
--   DELETE: own trips (via JOIN)
--   No UPDATE policy — links are immutable (created or deleted, not modified)
--
-- Grants:
--   GRANT SELECT, INSERT, DELETE ON ecosystem.trip_toursred_bookings TO authenticated
--   No UPDATE granted.
--   No access for anon.
--
-- Semantic integrity trigger:
--   After creating the bridge table, this migration also creates:
--     ecosystem.protect_linked_trip_item() — trigger function
--     trg_trip_items_protect_linked — trigger on ecosystem.trip_items
--
--   This trigger fires BEFORE UPDATE OF platform, item_type on trip_items.
--   If a trip_item has a link in trip_toursred_bookings, it rejects changes
--   that would set platform to anything other than 'toursred' or item_type
--   to anything other than 'tour'. The user must unlink the booking first.
-- ============================================================================

-- ============================================================================
-- 1. Table
-- ============================================================================
CREATE TABLE ecosystem.trip_toursred_bookings (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_item_id uuid        NOT NULL REFERENCES ecosystem.trip_items(id) ON DELETE CASCADE,
  booking_id   uuid        NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT trip_toursred_bookings_trip_item_unique UNIQUE (trip_item_id),
  CONSTRAINT trip_toursred_bookings_booking_unique UNIQUE (booking_id)
)
;



-- ============================================================================
-- 2. Indexes
-- ============================================================================
-- No additional indexes needed.
-- UNIQUE constraints on trip_item_id and booking_id automatically create
-- unique B-tree indexes that serve all lookup needs.

-- ============================================================================
-- 3. RLS
-- ============================================================================
ALTER TABLE ecosystem.trip_toursred_bookings ENABLE ROW LEVEL SECURITY
;



-- SELECT: links of own trips
;

super_admin/global sees all
CREATE POLICY "trip_toursred_bookings_select_own"
  ON ecosystem.trip_toursred_bookings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ecosystem.trip_items ti
      JOIN ecosystem.trips t ON t.id = ti.trip_id
      WHERE ti.id = trip_toursred_bookings.trip_item_id
        AND t.user_id = auth.uid()
    )
  )
;



CREATE POLICY "trip_toursred_bookings_select_admin"
  ON ecosystem.trip_toursred_bookings FOR SELECT
  TO authenticated
  USING (public.has_role('super_admin', 'global'))
;



-- INSERT: validates trip ownership + booking ownership + semantic compatibility
CREATE POLICY "trip_toursred_bookings_insert_own"
  ON ecosystem.trip_toursred_bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Condition 1: trip_item belongs to a trip owned by the user
    -- Condition 2: trip_item has platform='toursred' AND item_type='tour'
    EXISTS (
      SELECT 1 FROM ecosystem.trip_items ti
      JOIN ecosystem.trips t ON t.id = ti.trip_id
      WHERE ti.id = trip_item_id
        AND t.user_id = auth.uid()
        AND ti.platform = 'toursred'
        AND ti.item_type = 'tour'
    )
    AND
    -- Condition 3: booking belongs to the same user
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = booking_id
        AND b.user_id = auth.uid()
    )
  )
;



-- DELETE: unlink bookings from own trips
CREATE POLICY "trip_toursred_bookings_delete_own"
  ON ecosystem.trip_toursred_bookings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ecosystem.trip_items ti
      JOIN ecosystem.trips t ON t.id = ti.trip_id
      WHERE ti.id = trip_toursred_bookings.trip_item_id
        AND t.user_id = auth.uid()
    )
  )
;



-- No UPDATE policy — links are immutable

-- ============================================================================
-- 4. Grants
-- ============================================================================
GRANT SELECT, INSERT, DELETE ON ecosystem.trip_toursred_bookings TO authenticated
;


GRANT SELECT, INSERT, UPDATE, DELETE ON ecosystem.trip_toursred_bookings TO service_role
;



-- ============================================================================
-- 5. Semantic integrity: protect_linked_trip_item
-- Purpose: Prevent changing platform/item_type of a trip_item that is linked
--          to a ToursRed booking. The user must unlink the booking first.
-- Security: SECURITY INVOKER, search_path = ecosystem, pg_temp
-- No SQL dynamic. No SECURITY DEFINER.
-- ============================================================================

CREATE OR REPLACE FUNCTION ecosystem.protect_linked_trip_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ecosystem, pg_temp
AS $$
BEGIN
  -- Only validate if platform or item_type is changing
  IF (NEW.platform IS DISTINCT FROM OLD.platform)
     OR (NEW.item_type IS DISTINCT FROM OLD.item_type) THEN

    -- If linked to a ToursRed booking, item must remain toursred/tour
    IF EXISTS (
      SELECT 1 FROM ecosystem.trip_toursred_bookings tb
      WHERE tb.trip_item_id = NEW.id
    ) THEN
      IF NEW.platform <> 'toursred' OR NEW.item_type <> 'tour' THEN
        RAISE EXCEPTION
          'Cannot change platform/item_type of trip_item %: it is linked to a ToursRed booking. Unlink the booking first.',
          NEW.id
;


      END IF
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



-- Revoke default PUBLIC EXECUTE and grant only to needed roles
REVOKE EXECUTE ON FUNCTION ecosystem.protect_linked_trip_item() FROM PUBLIC
;


GRANT EXECUTE ON FUNCTION ecosystem.protect_linked_trip_item() TO authenticated, service_role
;



-- Trigger fires only when platform or item_type columns are modified
CREATE TRIGGER trg_trip_items_protect_linked
  BEFORE UPDATE OF platform, item_type ON ecosystem.trip_items
  FOR EACH ROW
  EXECUTE FUNCTION ecosystem.protect_linked_trip_item()
;
