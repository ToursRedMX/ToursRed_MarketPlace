-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260219005010
--   name:    add_insert_policy_referral_relationships
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
  # Add Insert Policy for Referral Relationships

  1. Security
    - Allow authenticated users to insert referral relationships when they are the referred user
    - This enables the signup process to create the relationship record
*/

-- Allow users to insert referral relationships where they are the referred user
CREATE POLICY "Users can create relationship when being referred"
  ON referral_relationships FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = referred_user_id)
;



-- Also allow service role to insert (for edge functions)
CREATE POLICY "Service role can insert referral relationships"
  ON referral_relationships FOR INSERT
  TO service_role
  WITH CHECK (true)
;



;
