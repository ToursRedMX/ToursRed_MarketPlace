-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260818204130
--   name:    20260818040001_create_mfa_recovery_codes_table.sql
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
# Create MFA Recovery Codes Table

1. New Tables
- `mfa_recovery_codes` — stores hashed recovery codes for MFA users.
  - `id` (uuid, primary key)
  - `user_id` (uuid, references auth.users, ON DELETE CASCADE)
  - `code_hash` (text, NOT NULL) — SHA-256 hash of pepper + code
  - `used_at` (timestamptz, nullable) — when a code was consumed
  - `created_at` (timestamptz, default now())

2. Security
- RLS enabled. Users can SELECT only their own rows (id, used_at, created_at — NOT code_hash).
- No INSERT/UPDATE/DELETE from frontend. Only service_role and SECURITY DEFINER functions can write.
- The pepper is stored in Supabase Vault (not in this table, not in code).

3. Indexes
- Index on `user_id` for fast lookups during recovery code validation.
*/

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz DEFAULT now()
)
;



ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY
;



DROP POLICY IF EXISTS "select_own_recovery_codes" ON mfa_recovery_codes
;


CREATE POLICY "select_own_recovery_codes"
  ON mfa_recovery_codes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id)
;



CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_user_id ON mfa_recovery_codes(user_id)
;



;
