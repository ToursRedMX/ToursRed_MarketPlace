-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260818204140
--   name:    20260818040004_add_mfa_prompt_dismissed_to_users.sql
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
# Add MFA Prompt Dismissed Column to Users

1. Modified Tables
- `users` — adds `mfa_prompt_dismissed_at` (timestamptz, nullable) to track when a user
  dismissed the MFA suggestion banner. When non-null, the banner is not shown.

2. Security
- Updates the existing UPDATE policy on `users` to allow users to update their own
  `mfa_prompt_dismissed_at` column (already covered by the existing self-update policy).
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'mfa_prompt_dismissed_at'
  ) THEN
    ALTER TABLE users ADD COLUMN mfa_prompt_dismissed_at timestamptz
;


  END IF
;


END $$
;



;
