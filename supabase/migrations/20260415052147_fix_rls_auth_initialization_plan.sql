-- ============================================================
-- admin_broadcast_messages
-- ============================================================
DROP POLICY IF EXISTS "Admins can view broadcast messages" ON public.admin_broadcast_messages;
CREATE POLICY "Admins can view broadcast messages"
  ON public.admin_broadcast_messages FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = 'admin'
  ));

DROP POLICY IF EXISTS "Admins can insert broadcast messages" ON public.admin_broadcast_messages;
CREATE POLICY "Admins can insert broadcast messages"
  ON public.admin_broadcast_messages FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = 'admin'
  ));

DROP POLICY IF EXISTS "Admins can update broadcast messages" ON public.admin_broadcast_messages;
CREATE POLICY "Admins can update broadcast messages"
  ON public.admin_broadcast_messages FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = 'admin'
  ));

-- ============================================================
-- cfdi_invoices
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all cfdi invoices" ON public.cfdi_invoices;
CREATE POLICY "Admins can view all cfdi invoices"
  ON public.cfdi_invoices FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ));

DROP POLICY IF EXISTS "Admins can insert cfdi invoices" ON public.cfdi_invoices;
CREATE POLICY "Admins can insert cfdi invoices"
  ON public.cfdi_invoices FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ));

DROP POLICY IF EXISTS "Admins can update cfdi invoices" ON public.cfdi_invoices;
CREATE POLICY "Admins can update cfdi invoices"
  ON public.cfdi_invoices FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ));

DROP POLICY IF EXISTS "Agencies can view their own cfdi invoices" ON public.cfdi_invoices;
CREATE POLICY "Agencies can view their own cfdi invoices"
  ON public.cfdi_invoices FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM agencies
    WHERE agencies.id = cfdi_invoices.agency_id
      AND agencies.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Travelers can view cfdi for their bookings" ON public.cfdi_invoices;
CREATE POLICY "Travelers can view cfdi for their bookings"
  ON public.cfdi_invoices FOR SELECT
  TO authenticated
  USING (
    invoice_type = 'booking'
    AND EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.id = cfdi_invoices.booking_id
        AND bookings.user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- cfdi_cancellation_requests
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all cfdi cancellations" ON public.cfdi_cancellation_requests;
CREATE POLICY "Admins can view all cfdi cancellations"
  ON public.cfdi_cancellation_requests FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ));

DROP POLICY IF EXISTS "Admins can insert cfdi cancellations" ON public.cfdi_cancellation_requests;
CREATE POLICY "Admins can insert cfdi cancellations"
  ON public.cfdi_cancellation_requests FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ));

DROP POLICY IF EXISTS "Admins can update cfdi cancellations" ON public.cfdi_cancellation_requests;
CREATE POLICY "Admins can update cfdi cancellations"
  ON public.cfdi_cancellation_requests FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ));

-- ============================================================
-- accounting_account_mapping
-- ============================================================
DROP POLICY IF EXISTS "Admins can view account mappings" ON public.accounting_account_mapping;
CREATE POLICY "Admins can view account mappings"
  ON public.accounting_account_mapping FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ));

DROP POLICY IF EXISTS "Admins can insert account mappings" ON public.accounting_account_mapping;
CREATE POLICY "Admins can insert account mappings"
  ON public.accounting_account_mapping FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ));

DROP POLICY IF EXISTS "Admins can update account mappings" ON public.accounting_account_mapping;
CREATE POLICY "Admins can update account mappings"
  ON public.accounting_account_mapping FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ));

DROP POLICY IF EXISTS "Admins can delete account mappings" ON public.accounting_account_mapping;
CREATE POLICY "Admins can delete account mappings"
  ON public.accounting_account_mapping FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ));

-- ============================================================
-- accounting_sync_log
-- ============================================================
DROP POLICY IF EXISTS "Admins can view accounting sync log" ON public.accounting_sync_log;
CREATE POLICY "Admins can view accounting sync log"
  ON public.accounting_sync_log FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ));

DROP POLICY IF EXISTS "Admins can insert accounting sync log" ON public.accounting_sync_log;
CREATE POLICY "Admins can insert accounting sync log"
  ON public.accounting_sync_log FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ));

DROP POLICY IF EXISTS "Admins can update accounting sync log" ON public.accounting_sync_log;
CREATE POLICY "Admins can update accounting sync log"
  ON public.accounting_sync_log FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (SELECT auth.uid())
      AND users.role = ANY (ARRAY['admin','super_admin'])
  ));
