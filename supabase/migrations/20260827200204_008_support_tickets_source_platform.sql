-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827200204
--   name:    008_support_tickets_source_platform.sql
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
-- Migration: 008_support_tickets_source_platform
-- Purpose: Add source_platform column to support_tickets
-- Schema: public
-- Backwards-compatible: YES
-- ToursRed impact: MINIMAL (new nullable column with DEFAULT, no changes to
--                  existing columns, enums, RLS, or triggers)
-- ============================================================================
--
-- Separates two dimensions in support_tickets:
--   tipo             = requester_type (who is asking for support)
--   source_platform  = which platform the issue originated from
--
-- This avoids creating nature_stay_guest or routesred_traveler as new
-- requester types. A traveler from Nature Stay uses tipo='traveler' with
-- source_platform='naturestayred'.
--
-- COMPATIBILITY NOTE:
--   The DEFAULT 'toursred' is a TEMPORARY measure to ensure existing
--   ticket creation flows that don't set source_platform continue to work.
--   A future migration will remove the DEFAULT once all write paths
--   explicitly set it.
-- ============================================================================

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS source_platform text DEFAULT 'toursred'
;



COMMENT ON COLUMN public.support_tickets.source_platform IS
  'Platform where the issue originated: toursred, naturestayred, routesred. TEMPORARY DEFAULT toursred for backwards compatibility.'
;



-- Backfill existing rows
UPDATE public.support_tickets
SET source_platform = 'toursred'
WHERE source_platform IS NULL
;



-- Add CHECK constraint (guarded for re-execution safety)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'support_tickets_source_platform_check'
      AND conrelid = 'public.support_tickets'::regclass
  ) THEN
    ALTER TABLE public.support_tickets
      ADD CONSTRAINT support_tickets_source_platform_check
      CHECK (source_platform IN ('toursred', 'naturestayred', 'routesred'))
;


  END IF
;


END $$
;



-- Index for filtering by platform
CREATE INDEX IF NOT EXISTS idx_support_tickets_source_platform
  ON public.support_tickets (source_platform)
;



;
