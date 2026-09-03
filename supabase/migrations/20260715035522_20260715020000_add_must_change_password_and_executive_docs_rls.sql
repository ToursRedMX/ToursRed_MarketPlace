-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260715035522
--   name:    20260715020000_add_must_change_password_and_executive_docs_rls.sql
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
# Add must_change_password flag and executive RLS on agency_documents

1. New Columns
- `users.must_change_password` (boolean, default false): When true, the user is forced
  to change their password on next login. Set by convert-lead-to-agency when an
  executive registers a new agency with an auto-generated temporary password.

2. Security Changes (RLS)
- `agency_documents`: Add SELECT policy "executive_read_own_agency_documents" so that
  an active account_executive can read documents for agencies they are assigned to.
  The policy uses a subquery joining account_executives to avoid RLS recursion.
  Write operations (approve/reject) are still handled server-side by the
  approve-agency-documents edge function using the service role key, so no
  INSERT/UPDATE/DELETE policies are added for executives here.

3. Important Notes
- The must_change_password column is non-destructive (boolean default false) and does
  not affect any existing users.
- The new RLS policy is additive — it does not modify or drop any existing policies
  on agency_documents.
*/

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Add must_change_password column to users
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'must_change_password'
  ) THEN
    ALTER TABLE public.users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false
;


  END IF
;


END $$
;



-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. RLS: Allow account executives to SELECT agency_documents for their agencies
-- ═══════════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "executive_read_own_agency_documents" ON public.agency_documents
;



CREATE POLICY "executive_read_own_agency_documents"
  ON public.agency_documents
  FOR SELECT TO authenticated
  USING (
    agency_id IN (
      SELECT a.id FROM public.agencies a
      JOIN public.account_executives ae ON a.account_executive_id = ae.id
      WHERE ae.user_id = (SELECT auth.uid())
        AND ae.is_active = true
    )
  )
;



;
