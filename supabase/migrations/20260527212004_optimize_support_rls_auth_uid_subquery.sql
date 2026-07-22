-- ============================================================
-- support_categories
-- ============================================================
DROP POLICY IF EXISTS "Admins delete support categories" ON public.support_categories;
CREATE POLICY "Admins delete support categories"
  ON public.support_categories
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (select auth.uid())
        AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins manage support categories" ON public.support_categories;
CREATE POLICY "Admins manage support categories"
  ON public.support_categories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (select auth.uid())
        AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins update support categories" ON public.support_categories;
CREATE POLICY "Admins update support categories"
  ON public.support_categories
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (select auth.uid())
        AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (select auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- support_subcategories
-- ============================================================
DROP POLICY IF EXISTS "Admins delete support subcategories" ON public.support_subcategories;
CREATE POLICY "Admins delete support subcategories"
  ON public.support_subcategories
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (select auth.uid())
        AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins manage support subcategories" ON public.support_subcategories;
CREATE POLICY "Admins manage support subcategories"
  ON public.support_subcategories
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (select auth.uid())
        AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins update support subcategories" ON public.support_subcategories;
CREATE POLICY "Admins update support subcategories"
  ON public.support_subcategories
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (select auth.uid())
        AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (select auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- support_tickets
-- ============================================================
DROP POLICY IF EXISTS "Admins update tickets" ON public.support_tickets;
CREATE POLICY "Admins update tickets"
  ON public.support_tickets
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (select auth.uid())
        AND users.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (select auth.uid())
        AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins view all tickets" ON public.support_tickets;
CREATE POLICY "Admins view all tickets"
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (select auth.uid())
        AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Agencies view assigned tickets" ON public.support_tickets;
CREATE POLICY "Agencies view assigned tickets"
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      JOIN agencies a ON a.user_id = u.id
      WHERE u.id = (select auth.uid())
        AND a.id = support_tickets.agencia_asignada_id
    )
  );

DROP POLICY IF EXISTS "Users view own tickets" ON public.support_tickets;
CREATE POLICY "Users view own tickets"
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- ============================================================
-- support_ticket_comments
-- ============================================================
DROP POLICY IF EXISTS "Admins view all comments" ON public.support_ticket_comments;
CREATE POLICY "Admins view all comments"
  ON public.support_ticket_comments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (select auth.uid())
        AND users.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Agencies view response comments on assigned tickets" ON public.support_ticket_comments;
CREATE POLICY "Agencies view response comments on assigned tickets"
  ON public.support_ticket_comments
  FOR SELECT
  TO authenticated
  USING (
    tipo = 'respuesta_usuario'
    AND EXISTS (
      SELECT 1
      FROM support_tickets st
      JOIN agencies a ON a.id = st.agencia_asignada_id
      JOIN users u ON u.id = a.user_id
      WHERE st.id = support_ticket_comments.ticket_id
        AND u.id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Authenticated users insert comments on own tickets" ON public.support_ticket_comments;
CREATE POLICY "Authenticated users insert comments on own tickets"
  ON public.support_ticket_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM support_tickets st
      WHERE st.id = support_ticket_comments.ticket_id
        AND (
          st.user_id = (select auth.uid())
          OR EXISTS (
            SELECT 1 FROM users
            WHERE users.id = (select auth.uid())
              AND users.role = 'admin'
          )
          OR EXISTS (
            SELECT 1 FROM agencies a
            JOIN users u ON u.id = a.user_id
            WHERE u.id = (select auth.uid())
              AND a.id = st.agencia_asignada_id
          )
        )
    )
  );

DROP POLICY IF EXISTS "Users view response comments on own tickets" ON public.support_ticket_comments;
CREATE POLICY "Users view response comments on own tickets"
  ON public.support_ticket_comments
  FOR SELECT
  TO authenticated
  USING (
    tipo = 'respuesta_usuario'
    AND EXISTS (
      SELECT 1 FROM support_tickets st
      WHERE st.id = support_ticket_comments.ticket_id
        AND st.user_id = (select auth.uid())
    )
  );
