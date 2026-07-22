-- ============================================================
-- agency_tour_message_recipients SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all message recipients" ON public.agency_tour_message_recipients;
DROP POLICY IF EXISTS "Agencies can view recipients of their messages" ON public.agency_tour_message_recipients;
CREATE POLICY "Agencies and admins can view message recipients"
  ON public.agency_tour_message_recipients FOR SELECT
  TO authenticated
  USING (
    message_id IN (
      SELECT atm.id FROM agency_tour_messages atm
      JOIN agencies a ON a.id = atm.agency_id
      WHERE a.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- agency_tour_messages SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all tour messages" ON public.agency_tour_messages;
DROP POLICY IF EXISTS "Agencies can view their own tour messages" ON public.agency_tour_messages;
CREATE POLICY "Agencies and admins can view tour messages"
  ON public.agency_tour_messages FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT agencies.id FROM agencies
      WHERE agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- support_agent_permissions SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins manage agent permissions" ON public.support_agent_permissions;
DROP POLICY IF EXISTS "Agents view own permissions" ON public.support_agent_permissions;
CREATE POLICY "Agents and admins can view agent permissions"
  ON public.support_agent_permissions FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- support_ticket_comments SELECT: 3 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins view all comments" ON public.support_ticket_comments;
DROP POLICY IF EXISTS "Agencies view response comments on assigned tickets" ON public.support_ticket_comments;
DROP POLICY IF EXISTS "Users view response comments on own tickets" ON public.support_ticket_comments;
CREATE POLICY "Users, agencies and admins can view ticket comments"
  ON public.support_ticket_comments FOR SELECT
  TO authenticated
  USING (
    (
      tipo = 'respuesta_usuario'
      AND EXISTS (
        SELECT 1 FROM support_tickets st
        WHERE st.id = support_ticket_comments.ticket_id
          AND st.user_id = (SELECT auth.uid())
      )
    )
    OR (
      tipo = 'respuesta_usuario'
      AND EXISTS (
        SELECT 1 FROM support_tickets st
        JOIN agencies a ON a.id = st.agencia_asignada_id
        JOIN users u ON u.id = a.user_id
        WHERE st.id = support_ticket_comments.ticket_id
          AND u.id = (SELECT auth.uid())
      )
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- support_tickets SELECT: 3 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins view all tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Agencies view assigned tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Users view own tickets" ON public.support_tickets;
CREATE POLICY "Users, agencies and admins can view support tickets"
  ON public.support_tickets FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR EXISTS (
      SELECT 1 FROM users u
      JOIN agencies a ON a.user_id = u.id
      WHERE u.id = (SELECT auth.uid())
        AND a.id = support_tickets.agencia_asignada_id
    )
    OR EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND users.role = 'admin'
    )
  );

-- ============================================================
-- tour_reschedules SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Agencies can view own reschedules" ON public.tour_reschedules;
DROP POLICY IF EXISTS "Travelers can view reschedules affecting their bookings" ON public.tour_reschedules;
CREATE POLICY "Agencies and travelers can view tour reschedules"
  ON public.tour_reschedules FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT agencies.id FROM agencies
      WHERE agencies.user_id = (SELECT auth.uid())
    )
    OR id IN (
      SELECT brr.tour_reschedule_id
      FROM booking_reschedule_responses brr
      WHERE brr.user_id = (SELECT auth.uid())
    )
  );

-- ============================================================
-- tour_schedules SELECT: 3 → 2
-- "Travelers can view active schedules" es duplicado de la política pública
-- "Public can view active schedules" — se elimina la redundante de authenticated
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all schedules" ON public.tour_schedules;
DROP POLICY IF EXISTS "Agency can view own tour schedules" ON public.tour_schedules;
DROP POLICY IF EXISTS "Travelers can view active schedules" ON public.tour_schedules;
CREATE POLICY "Agencies and admins can view tour schedules"
  ON public.tour_schedules FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT agencies.id FROM agencies
      WHERE agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = ANY (ARRAY['admin', 'super_admin'])
    )
    OR is_active = true
  );

-- ============================================================
-- tour_slot_blackouts SELECT: 2 → 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all blackouts" ON public.tour_slot_blackouts;
DROP POLICY IF EXISTS "Agency can view own blackouts" ON public.tour_slot_blackouts;
CREATE POLICY "Agencies and admins can view tour slot blackouts"
  ON public.tour_slot_blackouts FOR SELECT
  TO authenticated
  USING (
    agency_id IN (
      SELECT agencies.id FROM agencies
      WHERE agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );

-- ============================================================
-- tour_slots SELECT: 5 → 1
-- "Travelers can view active tour slots" es duplicado de la pública — se elimina
-- Las restantes 4 de authenticated se consolidan en 1
-- ============================================================
DROP POLICY IF EXISTS "Admins can view all tour slots" ON public.tour_slots;
DROP POLICY IF EXISTS "Agency can view own tour slots" ON public.tour_slots;
DROP POLICY IF EXISTS "Travelers can view active tour slots" ON public.tour_slots;
DROP POLICY IF EXISTS "Travelers can view slots from own bookings" ON public.tour_slots;
DROP POLICY IF EXISTS "Travelers can view target slots via their responses" ON public.tour_slots;
CREATE POLICY "Agencies, travelers and admins can view tour slots"
  ON public.tour_slots FOR SELECT
  TO authenticated
  USING (
    status = 'activo'
    OR agency_id IN (
      SELECT agencies.id FROM agencies
      WHERE agencies.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.slot_id = tour_slots.id
        AND b.user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM slot_reschedule_requests srq
      WHERE srq.target_slot_id = tour_slots.id
        AND srq.id IN (
          SELECT request_id FROM get_traveler_reschedule_request_ids((SELECT auth.uid()))
        )
    )
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = (SELECT auth.uid())
        AND u.role = ANY (ARRAY['admin', 'super_admin'])
    )
  );
