-- ============================================================================
-- EXPORTACION FUNCIONAL desde supabase_migrations.schema_migrations
--
-- Este archivo NO es la migracion original: es el SQL que la base registro
-- haber ejecutado, reconstruido a partir del ledger.
--
--   version: 20260821150734
--   name:    mfa_accountant_toggle_and_missing_aal2_rls
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


-- 1. Activar MFA obligatorio para accountant (Axel confirmó que así debía quedar)
UPDATE platform_settings SET mfa_required_for_accountant = true;

-- 2. users: agregar AAL2 solo al camino de super_admin, sin afectar auto-actualización del usuario
ALTER POLICY "Users and super admins can update users" ON public.users
USING (
  (( SELECT auth.uid() AS uid) = id)
  OR (is_super_admin() AND ((NOT requires_aal2_check()) OR has_aal2()))
)
WITH CHECK (
  (( SELECT auth.uid() AS uid) = id)
  OR (is_super_admin() AND ((NOT requires_aal2_check()) OR has_aal2()))
);

-- 3. agencies: agregar AAL2 solo al camino de admin/super_admin, sin afectar self-service ni account executives
ALTER POLICY "Agencies admins and executives can update agencies" ON public.agencies
USING (
  ((( SELECT auth.uid() AS uid) = user_id))
  OR (
    (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))))
    AND ((NOT requires_aal2_check()) OR has_aal2())
  )
  OR (account_executive_id IN ( SELECT ae.id FROM account_executives ae WHERE ((ae.user_id = ( SELECT auth.uid() AS uid)) AND (ae.is_active = true))))
)
WITH CHECK (
  ((( SELECT auth.uid() AS uid) = user_id))
  OR (
    (EXISTS ( SELECT 1 FROM users WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))))
    AND ((NOT requires_aal2_check()) OR has_aal2())
  )
  OR (account_executive_id IN ( SELECT ae.id FROM account_executives ae WHERE ((ae.user_id = ( SELECT auth.uid() AS uid)) AND (ae.is_active = true))))
);

-- 4. agencies: comisión — separar admin/super_admin (requiere AAL2) de account_executive (no aplica hoy)
ALTER POLICY "admin_update_agency_commission" ON public.agencies
USING (
  (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))) AND ((NOT requires_aal2_check()) OR has_aal2()))
  OR (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = auth.uid()) AND (u.role = 'account_executive'::text))))
)
WITH CHECK (
  (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = auth.uid()) AND (u.role = ANY (ARRAY['admin'::text, 'super_admin'::text])))) AND ((NOT requires_aal2_check()) OR has_aal2()))
  OR (EXISTS ( SELECT 1 FROM users u WHERE ((u.id = auth.uid()) AND (u.role = 'account_executive'::text))))
);

-- 5. bookings: cancelación admin vía RLS directa (no service_role) — agregar AAL2
ALTER POLICY "Admins can delete unpaid bookings" ON public.bookings
USING (
  (( SELECT current_user_has_role(ARRAY['admin'::text]) AS current_user_has_role))
  AND ((NOT requires_aal2_check()) OR has_aal2())
  AND (
    (payment_status = 'pending'::text)
    OR ((payment_status = 'processing'::text) AND (payment_method = 'Transferencia Bancaria'::text))
    OR ((payment_status = 'processing'::text) AND (created_at < (now() - '3 days'::interval)))
  )
);

;
