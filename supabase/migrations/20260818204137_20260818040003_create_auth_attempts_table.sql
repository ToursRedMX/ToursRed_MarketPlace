-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260818204137
--   name:    20260818040003_create_auth_attempts_table.sql
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

/*
# Create Auth Attempts Table (Rate Limiting)

1. New Tables
- `auth_attempts` — tracks TOTP and recovery code verification attempts for rate limiting.
  - `id` (uuid, primary key)
  - `user_id` (uuid, nullable — may be unknown for unauthenticated attempts)
  - `attempt_type` (text, NOT NULL) — 'totp_verify' or 'recovery_code'
  - `attempted_at` (timestamptz, default now())
  - `ip_address` (text, nullable)
  - `success` (boolean, nullable)

2. Security
- RLS enabled. No frontend access at all — only service_role and SECURITY DEFINER functions.
- No policies created for anon/authenticated. The table is locked to frontend access.

3. Indexes
- Composite index on (user_id, attempt_type, attempted_at) for rate-limit window queries.
*/

CREATE TABLE IF NOT EXISTS auth_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  attempt_type text NOT NULL,
  attempted_at timestamptz DEFAULT now(),
  ip_address text,
  success boolean
)
;



ALTER TABLE auth_attempts ENABLE ROW LEVEL SECURITY
;



CREATE INDEX IF NOT EXISTS idx_auth_attempts_user_type_time
  ON auth_attempts(user_id, attempt_type, attempted_at DESC)
;



;
