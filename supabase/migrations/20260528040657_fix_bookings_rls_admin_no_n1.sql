-- Eliminar politica SELECT existente
DROP POLICY IF EXISTS "Users, agencies and admins can read bookings" ON bookings;

-- Nueva politica optimizada: admin verifica en subquery constante
CREATE POLICY "Users agencies and admins can read bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    -- El usuario es el dueno de la reserva
    (SELECT auth.uid()) = user_id
    OR
    -- El usuario pertenece a la agencia de la reserva
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = bookings.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
    OR
    -- El usuario es admin (subquery evaluada una sola vez)
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = (SELECT auth.uid())
        AND (users.role = 'admin' OR users.is_super_admin = true)
    )
    OR
    -- Tiene permiso de manejo de viajeros
    EXISTS (
      SELECT 1 FROM users u2
      JOIN admin_permissions ap ON ap.user_id = u2.id
      WHERE u2.id = (SELECT auth.uid())
        AND ap.can_manage_travelers = true
    )
  );
