-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260818204133
--   name:    20260818040002_create_sensitive_verifications_table.sql
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
# Create Sensitive Verifications Table

1. New Tables
- `sensitive_verifications` — tracks recent TOTP verifications for step-up auth.
  - `id` (uuid, primary key)
  - `user_id` (uuid, references auth.users, ON DELETE CASCADE)
  - `verified_at` (timestamptz, default now())
  - `method` (text, NOT NULL) — 'totp' or 'passkey'
  - `expires_at` (timestamptz, NOT NULL) — verified_at + 15 minutes

2. Security
- RLS enabled. Users can SELECT their own rows.
- INSERT only via service_role (Edge Functions with service key).
- No UPDATE/DELETE from frontend.

3. Indexes
- Composite index on (user_id, expires_at) for fast validity checks.
*/

CREATE TABLE IF NOT EXISTS sensitive_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verified_at timestamptz DEFAULT now(),
  method text NOT NULL,
  expires_at timestamptz NOT NULL
)
;



ALTER TABLE sensitive_verifications ENABLE ROW LEVEL SECURITY
;



DROP POLICY IF EXISTS "select_own_sensitive_verifications" ON sensitive_verifications
;


CREATE POLICY "select_own_sensitive_verifications"
  ON sensitive_verifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id)
;



CREATE INDEX IF NOT EXISTS idx_sensitive_verifications_user_expires
  ON sensitive_verifications(user_id, expires_at DESC)
;



;
