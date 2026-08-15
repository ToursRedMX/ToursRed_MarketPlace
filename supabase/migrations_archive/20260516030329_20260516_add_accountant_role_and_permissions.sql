
-- Modificar el constraint de role en users para incluir 'accountant'
DO $$
BEGIN
  -- Eliminar constraint existente si existe
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  -- Recrear con el nuevo valor
  ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('traveler', 'agency', 'admin', 'accountant'));
EXCEPTION WHEN others THEN
  -- Si no existe el constraint original, agregarlo directamente
  ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('traveler', 'agency', 'admin', 'accountant'));
END $$;

-- Agregar permisos contables a admin_permissions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_permissions' AND column_name = 'can_view_accounting'
  ) THEN
    ALTER TABLE admin_permissions ADD COLUMN can_view_accounting boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_permissions' AND column_name = 'can_export_sat_xml'
  ) THEN
    ALTER TABLE admin_permissions ADD COLUMN can_export_sat_xml boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_permissions' AND column_name = 'can_manage_chart_of_accounts'
  ) THEN
    ALTER TABLE admin_permissions ADD COLUMN can_manage_chart_of_accounts boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Tabla de invitaciones para contadores externos
CREATE TABLE IF NOT EXISTS accounting_access_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL DEFAULT '',
  invited_by uuid NOT NULL REFERENCES users(id),
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  permissions jsonb NOT NULL DEFAULT '{"can_view_accounting": true, "can_export_sat_xml": true, "can_manage_chart_of_accounts": false}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users(id),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounting_invitations_email ON accounting_access_invitations(email);
CREATE INDEX IF NOT EXISTS idx_accounting_invitations_token ON accounting_access_invitations(token);
CREATE INDEX IF NOT EXISTS idx_accounting_invitations_status ON accounting_access_invitations(status);

ALTER TABLE accounting_access_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view accounting invitations"
  ON accounting_access_invitations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role = 'admin'
    )
  );

CREATE POLICY "Admins can insert accounting invitations"
  ON accounting_access_invitations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role = 'admin'
    )
  );

CREATE POLICY "Admins can update accounting invitations"
  ON accounting_access_invitations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role = 'admin'
    )
  );

CREATE POLICY "Service role full access accounting invitations"
  ON accounting_access_invitations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Actualizar RLS de chart_of_accounts para accountant
-- (Las politicas ya incluyen 'accountant' desde la migracion anterior)

-- Asegurar que contadores puedan ver su propio perfil
CREATE POLICY "Accountant can view own profile"
  ON users FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR (
      EXISTS (
        SELECT 1 FROM users u
        WHERE u.id = auth.uid()
        AND u.role IN ('admin', 'accountant')
      )
    )
  );
