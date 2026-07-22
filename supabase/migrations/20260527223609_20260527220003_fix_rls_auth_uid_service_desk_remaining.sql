-- ============================================================
-- support_ticket_attachments
-- ============================================================
DROP POLICY IF EXISTS "Users view attachments on own tickets" ON public.support_ticket_attachments;
CREATE POLICY "Users view attachments on own tickets"
  ON public.support_ticket_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM support_tickets st
      WHERE st.id = ticket_id
        AND (
          st.user_id = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1 FROM users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
          )
          OR EXISTS (
            SELECT 1 FROM agencies a
            JOIN users u ON u.id = a.user_id
            WHERE u.id = (SELECT auth.uid())
              AND a.id = st.agencia_asignada_id
          )
        )
    )
  );

-- ============================================================
-- support_ticket_history
-- ============================================================
DROP POLICY IF EXISTS "Users view history of own tickets" ON public.support_ticket_history;
CREATE POLICY "Users view history of own tickets"
  ON public.support_ticket_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM support_tickets st
      WHERE st.id = ticket_id
        AND (
          st.user_id = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1 FROM users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
          )
          OR EXISTS (
            SELECT 1 FROM agencies a
            JOIN users u ON u.id = a.user_id
            WHERE u.id = (SELECT auth.uid())
              AND a.id = st.agencia_asignada_id
          )
        )
    )
  );

-- ============================================================
-- support_agent_permissions
-- ============================================================
DROP POLICY IF EXISTS "Admins manage agent permissions" ON public.support_agent_permissions;
CREATE POLICY "Admins manage agent permissions"
  ON public.support_agent_permissions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins insert agent permissions" ON public.support_agent_permissions;
CREATE POLICY "Admins insert agent permissions"
  ON public.support_agent_permissions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins update agent permissions" ON public.support_agent_permissions;
CREATE POLICY "Admins update agent permissions"
  ON public.support_agent_permissions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins delete agent permissions" ON public.support_agent_permissions;
CREATE POLICY "Admins delete agent permissions"
  ON public.support_agent_permissions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Agents view own permissions" ON public.support_agent_permissions;
CREATE POLICY "Agents view own permissions"
  ON public.support_agent_permissions FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ============================================================
-- support_ticket_comments — política INSERT restante
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users insert comments on own tickets" ON public.support_ticket_comments;
CREATE POLICY "Authenticated users insert comments on own tickets"
  ON public.support_ticket_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM support_tickets st
      WHERE st.id = support_ticket_comments.ticket_id
        AND (
          st.user_id = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1 FROM users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
          )
          OR EXISTS (
            SELECT 1 FROM agencies a
            JOIN users u ON u.id = a.user_id
            WHERE u.id = (SELECT auth.uid())
              AND a.id = st.agencia_asignada_id
          )
        )
    )
  );
