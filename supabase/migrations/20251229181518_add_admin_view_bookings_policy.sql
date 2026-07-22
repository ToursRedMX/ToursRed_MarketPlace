
-- Crear política para que administradores con permiso puedan ver todas las reservas
CREATE POLICY "Admins with manage travelers permission can view all bookings"
  ON bookings
  FOR SELECT
  TO authenticated
  USING (public.has_manage_travelers_permission());
