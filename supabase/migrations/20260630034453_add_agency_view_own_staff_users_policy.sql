
-- Permite a la agencia ver los datos de usuario de sus coordinadores (staff)
-- sin necesidad de que tengan reservas
CREATE POLICY "Agency can view own staff users"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM agency_staff ast
      JOIN agencies a ON a.id = ast.agency_id
      WHERE ast.user_id = users.id
        AND a.user_id = (SELECT auth.uid())
    )
  );
