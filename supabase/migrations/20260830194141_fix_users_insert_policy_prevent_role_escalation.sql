-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260830194141
--   name:    fix_users_insert_policy_prevent_role_escalation
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

-- CRITICO: la politica de INSERT en public.users solo verificaba auth.uid() = id,
-- sin restringir el valor de 'role' ni 'is_super_admin'. Cualquier usuario autenticado
-- (recien registrado via email/password u OAuth) podia insertarse a si mismo con
-- role='admin' e is_super_admin=true directo via el SDK de Supabase, sin pasar por
-- ninguna Edge Function ni RPC.
--
-- Verificado: el unico uso legitimo de este INSERT directo desde el frontend es en
-- las 4 paginas de alta de VIAJERO via OAuth (Google/X/Azure/Facebook). El alta de
-- agencia pasa por el RPC complete_agency_onboarding (SECURITY DEFINER, no usa esta
-- politica). Admin/super_admin/accountant/account_executive se crean exclusivamente
-- via Edge Functions con service role (create-admin-user, create-executive-user,
-- convert-lead-to-agency), que tambien ignoran esta politica.

DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;

CREATE POLICY "Users can insert own profile"
ON public.users
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = id
  AND role = 'traveler'
  AND COALESCE(is_super_admin, false) = false
)
;
