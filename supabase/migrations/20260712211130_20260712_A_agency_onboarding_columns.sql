-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260712211130
--   name:    20260712_A_agency_onboarding_columns.sql
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

-- Migration A: Agency onboarding columns
-- Adds onboarding_status, persona_type, representante_legal_nombre, and related tracking columns to agencies

-- 1. onboarding_status with SAFE default 'pending_documents'
ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS onboarding_status text NOT NULL DEFAULT 'pending_documents'
    CHECK (onboarding_status IN ('pending_documents','pending_review','pending_signature','active','rejected'))
;



-- 2. Explicit backfill for existing agencies (do NOT rely on the default)
UPDATE agencies SET onboarding_status = 'active'           WHERE is_approved = true
;


UPDATE agencies SET onboarding_status = 'pending_documents' WHERE is_approved = false
;



-- 3. persona_type: add nullable first, backfill, then set NOT NULL
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS persona_type text
  CHECK (persona_type IN ('persona_fisica','persona_moral'))
;



UPDATE agencies SET persona_type =
  CASE
    WHEN rfc IS NOT NULL AND LENGTH(rfc) = 13 THEN 'persona_fisica'
    WHEN rfc IS NOT NULL AND LENGTH(rfc) = 12 THEN 'persona_moral'
    ELSE 'persona_fisica'   -- conservative fallback for null RFC
  END
WHERE persona_type IS NULL
;



ALTER TABLE agencies ALTER COLUMN persona_type SET NOT NULL
;



-- 4. representante_legal_nombre (nullable — enforced by UX, not DB constraint)
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS representante_legal_nombre text
;



-- 5. Onboarding tracking timestamps & approval metadata
ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS terms_accepted_at          timestamptz,
  ADD COLUMN IF NOT EXISTS documents_completed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at                timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at                timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_category         text
    CHECK (rejection_category IN ('fraude','documentos_invalidos','negocio_no_elegible','otro')),
  ADD COLUMN IF NOT EXISTS reversal_at                timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason            text
;



-- rejection_reason already exists — skip

-- 6. Index for quick filtering by onboarding_status
CREATE INDEX IF NOT EXISTS idx_agencies_onboarding_status ON agencies(onboarding_status)
;



;
