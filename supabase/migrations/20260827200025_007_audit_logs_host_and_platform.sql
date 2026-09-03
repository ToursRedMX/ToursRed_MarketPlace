-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260827200025
--   name:    007_audit_logs_host_and_platform.sql
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
-- Migration: 007_audit_logs_host_and_platform
-- Purpose: Add 'host' to tenant_type enum and source_platform column to audit_logs
-- Schema: public
-- Backwards-compatible: YES
-- ToursRed impact: MINIMAL (new enum value, new nullable column with DEFAULT)
-- ============================================================================
--
-- Separates two dimensions in audit_logs:
--   tenant_type      = the ACTOR (who performed the action)
--   source_platform  = the PLATFORM (where the action occurred)
--
-- This avoids using 'naturestayred' as a tenant_type (semantically incorrect).
--
-- Example:
--   tenant_type      = 'host'
--   source_platform  = 'naturestayred'
--
-- Or:
--   tenant_type      = 'admin'
--   source_platform  = 'naturestayred'
--
-- COMPATIBILITY NOTE:
--   The DEFAULT 'toursred' on source_platform is a TEMPORARY measure.
--   Existing audit log insert functions that don't set source_platform
--   will continue to work. A future migration will remove the DEFAULT
--   once all write paths explicitly set it.
--
-- NOTE: In modern PostgreSQL (12+), ALTER TYPE ADD VALUE can run inside
-- a transaction block, but the new value cannot be used until the
-- transaction is committed. Since these migrations do not reference the
-- new enum value immediately, the current approach is safe.
-- ============================================================================

-- Add 'host' as a valid actor type
ALTER TYPE public.tenant_type ADD VALUE IF NOT EXISTS 'host'
;



-- Add source_platform column
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS source_platform text DEFAULT 'toursred'
;



COMMENT ON COLUMN public.audit_logs.source_platform IS
  'Platform where the action occurred: toursred, naturestayred, routesred, ecosystem, system. TEMPORARY DEFAULT toursred for backwards compatibility.'
;



-- Backfill existing rows
UPDATE public.audit_logs
SET source_platform = 'toursred'
WHERE source_platform IS NULL
;



-- Add CHECK constraint (guarded for re-execution safety)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audit_logs_source_platform_check'
      AND conrelid = 'public.audit_logs'::regclass
  ) THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_source_platform_check
      CHECK (source_platform IN ('toursred', 'naturestayred', 'routesred', 'ecosystem', 'system'))
;


  END IF
;


END $$
;



-- Index for filtering by platform
CREATE INDEX IF NOT EXISTS idx_audit_logs_source_platform
  ON public.audit_logs (source_platform)
;



;
