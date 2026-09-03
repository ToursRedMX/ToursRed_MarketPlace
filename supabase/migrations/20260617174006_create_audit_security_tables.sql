
-- ============================================================
-- AUDIT, SECURITY & TRACEABILITY — MIGRATION 1
-- Core tables: user_sessions, audit_logs (partitioned), failed_login_attempts
-- ============================================================

-- -------------------------------------------------------
-- 1. tenant_type ENUM
-- -------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE tenant_type AS ENUM (
    'traveler',
    'agency',
    'admin',
    'accountant',
    'account_executive',
    'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -------------------------------------------------------
-- 2. user_sessions
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  session_id          text,                          -- Supabase Auth session id (nullable; not always available)

  -- Timestamps
  login_at            timestamptz NOT NULL DEFAULT now(),
  logout_at           timestamptz,

  -- Network
  ip_address          inet,
  ip_masked           text,                          -- pre-computed masked IP for non-sensitive view

  -- Geo fields (all nullable — populated asynchronously by geo-lookup)
  country             text,
  country_code        char(2),
  city                text,
  region              text,
  postal_code         text,
  latitude            numeric(9,6),
  longitude           numeric(9,6),
  is_proxy            boolean,
  is_hosting          boolean,
  geo_provider        text,                          -- e.g. 'ipinfo_lite', 'ipinfo_paid', 'maxmind'

  -- Device
  browser             text,
  browser_version     text,
  os                  text,
  os_version          text,
  device_type         text,                          -- 'desktop' | 'mobile' | 'tablet'
  device_name         text,
  device_fingerprint  text,                          -- hash of UA+lang+tz+screen+platform
  user_agent          text,

  -- Auth
  login_method        text        NOT NULL DEFAULT 'email_password',
  success             boolean     NOT NULL DEFAULT true,
  failure_reason      text,

  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id        ON user_sessions (user_id, login_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_ip             ON user_sessions (ip_address, login_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id     ON user_sessions (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_sessions_success        ON user_sessions (success, login_at DESC);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- RLS policies: only via service_role (edge functions) or admin users
CREATE POLICY "service_role_all_user_sessions" ON user_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "users_read_own_sessions" ON user_sessions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Immutability: authenticated users cannot mutate session records
REVOKE UPDATE, DELETE ON user_sessions FROM authenticated;

-- -------------------------------------------------------
-- 3. audit_logs — partitioned base table (annual)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_type     tenant_type NOT NULL,
  actor_id        uuid,                              -- user who performed the action (null = system)
  actor_email     text,                              -- snapshot at time of action
  actor_role      text,
  target_id       text,                              -- PK of affected row (any type, cast to text)
  target_table    text        NOT NULL,
  action          text        NOT NULL,              -- 'INSERT' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | etc.
  old_values      jsonb,
  new_values      jsonb,
  diff            jsonb,                             -- computed diff (new minus old)
  ip_address      inet,
  ip_masked       text,
  user_agent      text,
  session_id      text,
  correlation_id  uuid,                              -- groups related operations
  metadata        jsonb,                             -- arbitrary extra context
  error_message   text,                              -- if this log records a failure
  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Annual partitions (2025-2029)
CREATE TABLE IF NOT EXISTS audit_logs_2025
  PARTITION OF audit_logs
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE TABLE IF NOT EXISTS audit_logs_2026
  PARTITION OF audit_logs
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE TABLE IF NOT EXISTS audit_logs_2027
  PARTITION OF audit_logs
  FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

CREATE TABLE IF NOT EXISTS audit_logs_2028
  PARTITION OF audit_logs
  FOR VALUES FROM ('2028-01-01') TO ('2029-01-01');

CREATE TABLE IF NOT EXISTS audit_logs_2029
  PARTITION OF audit_logs
  FOR VALUES FROM ('2029-01-01') TO ('2030-01-01');

-- Indexes on each partition (Postgres inherits them automatically via parent if created on parent)
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id      ON audit_logs (actor_id,     created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target        ON audit_logs (target_table, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action        ON audit_logs (action,       created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation   ON audit_logs (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_type   ON audit_logs (tenant_type,  created_at DESC);

-- RLS: disabled on base table — all access through views (see migration 4)
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;

-- Immutability: no role (not even authenticated) can update or delete audit records
REVOKE UPDATE, DELETE ON audit_logs FROM authenticated;
REVOKE UPDATE, DELETE ON audit_logs FROM anon;

-- -------------------------------------------------------
-- 4. failed_login_attempts
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS failed_login_attempts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  email               text,                          -- attempted email (may not map to a user)
  ip_address          inet,
  device_fingerprint  text,
  failure_reason      text,                          -- 'invalid_password' | 'user_not_found' | 'account_disabled' | etc.
  attempted_at        timestamptz NOT NULL DEFAULT now()
);

-- Composite indexes for the 3 lock-out dimensions
CREATE INDEX IF NOT EXISTS idx_fla_user_id       ON failed_login_attempts (user_id,    attempted_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fla_ip            ON failed_login_attempts (ip_address, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_fla_user_ip_fp    ON failed_login_attempts (user_id, ip_address, device_fingerprint, attempted_at DESC);

ALTER TABLE failed_login_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_failed_logins" ON failed_login_attempts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE UPDATE, DELETE ON failed_login_attempts FROM authenticated;
REVOKE UPDATE, DELETE ON failed_login_attempts FROM anon;
