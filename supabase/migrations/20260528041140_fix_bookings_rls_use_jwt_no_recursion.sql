
DROP POLICY IF EXISTS "Users agencies and admins can read bookings" ON bookings;

CREATE POLICY "Users agencies and admins can read bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    -- El usuario es dueno de la reserva
    (SELECT auth.uid()) = user_id
    OR
    -- El usuario pertenece a la agencia de la reserva
    EXISTS (
      SELECT 1 FROM agencies
      WHERE agencies.id = bookings.agency_id
        AND agencies.user_id = (SELECT auth.uid())
    )
    OR
    -- El usuario es admin o super_admin segun su JWT (sin tocar tabla users)
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
  );
