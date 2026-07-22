
-- ============================================================
-- AUDIT, SECURITY & TRACEABILITY — MIGRATION 2
-- Extend existing tables with audit/security columns
-- ============================================================

-- -------------------------------------------------------
-- 1. admin_permissions — 3 new audit access columns
-- -------------------------------------------------------
ALTER TABLE admin_permissions
  ADD COLUMN IF NOT EXISTS can_view_audit_log              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_view_audit_sensitive_data   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_export_audit_log            boolean NOT NULL DEFAULT false;

-- -------------------------------------------------------
-- 2. platform_settings — geo + login threshold settings
-- -------------------------------------------------------
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS geo_provider              text    NOT NULL DEFAULT 'ipinfo_lite',
  ADD COLUMN IF NOT EXISTS geo_api_key               text,
  ADD COLUMN IF NOT EXISTS login_max_attempts_user   integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS login_max_attempts_ip     integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS login_block_duration_min  integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS login_delay_base_ms       integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS login_delay_max_ms        integer NOT NULL DEFAULT 30000;

-- -------------------------------------------------------
-- 3. tours — is_published + published_at
-- -------------------------------------------------------
ALTER TABLE tours
  ADD COLUMN IF NOT EXISTS is_published  boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS published_at  timestamptz;

-- Back-fill published_at for existing tours
UPDATE tours
  SET published_at = created_at
  WHERE is_published = true AND published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tours_is_published ON tours (is_published, created_at DESC);

-- -------------------------------------------------------
-- 4. agencies — rejection_reason
-- -------------------------------------------------------
ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS rejection_reason text;
