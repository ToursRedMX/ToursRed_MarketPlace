
-- Crear política para que administradores con permiso puedan ver todas las membresías
CREATE POLICY "Admins with manage travelers permission can view all memberships"
  ON memberships
  FOR SELECT
  TO authenticated
  USING (public.has_manage_travelers_permission());
