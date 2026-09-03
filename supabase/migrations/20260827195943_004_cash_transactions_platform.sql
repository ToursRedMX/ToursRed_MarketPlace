-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827195943
--   name:    004_cash_transactions_platform.sql
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
-- Migration: 004_cash_transactions_platform
-- Purpose: Add platform column to toursred_cash_transactions for cross-platform
--          traceability
-- Schema: public
-- Backwards-compatible: YES
-- ToursRed impact: MINIMAL (new nullable column with DEFAULT, no changes to
--                  existing columns, RLS, triggers, or functions)
-- ============================================================================
--
-- The platform column separates the platform dimension from reference_type.
--
-- Example:
--   platform        = 'naturestayred'
--   reference_type  = 'booking'
--   reference_id    = <UUID of nature_stay.bookings row>
--
-- COMPATIBILITY NOTE:
--   The DEFAULT 'toursred' is a TEMPORARY measure to ensure existing Edge
--   Functions that insert into toursred_cash_transactions without specifying
--   platform continue to work. Once all write paths explicitly set platform,
--   a future migration will remove this DEFAULT and add a NOT NULL constraint.
-- ============================================================================

ALTER TABLE public.toursred_cash_transactions
  ADD COLUMN IF NOT EXISTS platform text DEFAULT 'toursred'
;



COMMENT ON COLUMN public.toursred_cash_transactions.platform IS
  'Platform identifier: toursred, naturestayred, routesred, ecosystem, system. TEMPORARY DEFAULT toursred for backwards compatibility with existing Edge Functions.'
;



-- Backfill existing rows
UPDATE public.toursred_cash_transactions
SET platform = 'toursred'
WHERE platform IS NULL
;



-- Add CHECK constraint (guarded for re-execution safety)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'toursred_cash_transactions_platform_check'
      AND conrelid = 'public.toursred_cash_transactions'::regclass
  ) THEN
    ALTER TABLE public.toursred_cash_transactions
      ADD CONSTRAINT toursred_cash_transactions_platform_check
      CHECK (platform IN ('toursred', 'naturestayred', 'routesred', 'ecosystem', 'system'))
;


  END IF
;


END $$
;



-- Index for analytics and filtering by platform
CREATE INDEX IF NOT EXISTS idx_cash_transactions_platform
  ON public.toursred_cash_transactions (platform)
;



;
